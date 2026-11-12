"""
Market Plus AI - Model Registry Service

Maintains an in-memory registry of prediction-model metadata.

The registry records model versions, evaluation metrics, training
timestamps, and activation status. It does not train models or persist
records to a database; persistence will be connected during integration.

Important:
    - A model is not automatically trustworthy because it has a good score.
    - Comparisons should use compatible evaluation datasets and horizons.
    - Only explicitly registered models can be selected.
"""

from __future__ import annotations

from datetime import datetime, timezone
from threading import RLock
from typing import Any, Mapping
from uuid import uuid4
import math


_METRIC_DIRECTIONS = {
    "mae": "lower",
    "mse": "lower",
    "rmse": "lower",
    "mape": "lower",
    "smape": "lower",
    "directional_accuracy": "higher",
}

_registry: dict[str, dict[str, Any]] = {}
_lock = RLock()


def _finite_number(value: Any) -> float | None:
    """Return a finite float, or None if conversion is not possible."""
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None

    return number if math.isfinite(number) else None


def _utc_now() -> str:
    """Return the current UTC timestamp."""
    return datetime.now(timezone.utc).isoformat()


def _validate_text(value: Any, field_name: str) -> str:
    """Validate a required text field."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty string.")

    return value.strip()


def _normalize_metrics(
    metrics: Mapping[str, Any] | None,
) -> dict[str, float]:
    """Validate supported evaluation metrics."""
    if metrics is None:
        return {}

    if not isinstance(metrics, Mapping):
        raise ValueError("Metrics must be supplied as a mapping.")

    normalized: dict[str, float] = {}

    for raw_name, raw_value in metrics.items():
        name = str(raw_name).strip().lower()

        if name not in _METRIC_DIRECTIONS:
            continue

        value = _finite_number(raw_value)

        if value is None:
            raise ValueError(
                f"Metric '{name}' must be a finite numeric value."
            )

        if name in {
            "mae", "mse", "rmse", "mape", "smape",
        } and value < 0:
            raise ValueError(
                f"Metric '{name}' cannot be negative."
            )

        if name == "directional_accuracy":
            if 0 <= value <= 1:
                value *= 100.0

            if not 0 <= value <= 100:
                raise ValueError(
                    "Directional accuracy must be between 0 and 100."
                )

        normalized[name] = round(value, 8)

    return normalized


def register_model(
    *,
    model_name: str,
    version: str,
    algorithm: str,
    metrics: Mapping[str, Any] | None = None,
    symbol: str | None = None,
    horizon_days: int | None = None,
    training_rows: int | None = None,
    validation_rows: int | None = None,
    dataset_fingerprint: str | None = None,
    parameters: Mapping[str, Any] | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """
    Register model metadata.

    A new unique registry ID is created for every registration.
    The underlying model object or serialized model file is not stored.
    """
    clean_name = _validate_text(model_name, "Model name")
    clean_version = _validate_text(version, "Version")
    clean_algorithm = _validate_text(algorithm, "Algorithm")

    clean_metrics = _normalize_metrics(metrics)

    if horizon_days is not None:
        if (
            isinstance(horizon_days, bool)
            or not isinstance(horizon_days, int)
            or horizon_days < 1
        ):
            raise ValueError("Horizon days must be a positive integer.")

    for field_name, value in (
        ("Training rows", training_rows),
        ("Validation rows", validation_rows),
    ):
        if value is not None and (
            isinstance(value, bool)
            or not isinstance(value, int)
            or value < 0
        ):
            raise ValueError(
                f"{field_name} must be a nonnegative integer."
            )

    if parameters is not None and not isinstance(parameters, Mapping):
        raise ValueError("Parameters must be supplied as a mapping.")

    clean_parameters = dict(parameters or {})

    # Ensure stored metadata can be serialized in API responses.
    import json

    try:
        json.dumps(clean_parameters, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            "Parameters must contain JSON-serializable values."
        ) from exc

    record_id = str(uuid4())

    record = {
        "registry_id": record_id,
        "model_name": clean_name,
        "version": clean_version,
        "algorithm": clean_algorithm,
        "symbol": symbol.strip().upper() if symbol else None,
        "horizon_days": horizon_days,
        "training_rows": training_rows,
        "validation_rows": validation_rows,
        "dataset_fingerprint": dataset_fingerprint,
        "metrics": clean_metrics,
        "parameters": clean_parameters,
        "notes": notes.strip() if isinstance(notes, str) else None,
        "registered_at": _utc_now(),
        "updated_at": _utc_now(),
        "active": False,
    }

    with _lock:
        _registry[record_id] = record

    return dict(record)


def get_model(registry_id: str) -> dict[str, Any] | None:
    """Retrieve one registered model by ID."""
    with _lock:
        record = _registry.get(str(registry_id))

        return dict(record) if record else None


def list_models(
    *,
    symbol: str | None = None,
    algorithm: str | None = None,
    active_only: bool = False,
) -> list[dict[str, Any]]:
    """List models with optional symbol, algorithm, and status filters."""
    normalized_symbol = symbol.strip().upper() if symbol else None
    normalized_algorithm = algorithm.strip().lower() if algorithm else None

    with _lock:
        records = [
            dict(record)
            for record in _registry.values()
            if (
                not normalized_symbol
                or record.get("symbol") == normalized_symbol
            )
            and (
                not normalized_algorithm
                or record.get("algorithm", "").lower()
                == normalized_algorithm
            )
            and (
                not active_only
                or record.get("active") is True
            )
        ]

    records.sort(
        key=lambda item: item.get("registered_at", ""),
        reverse=True,
    )

    return records


def update_model_metrics(
    registry_id: str,
    metrics: Mapping[str, Any],
    *,
    validation_rows: int | None = None,
    dataset_fingerprint: str | None = None,
) -> dict[str, Any]:
    """Update evaluation metrics for an existing registered model."""
    clean_metrics = _normalize_metrics(metrics)

    if validation_rows is not None and (
        isinstance(validation_rows, bool)
        or not isinstance(validation_rows, int)
        or validation_rows < 0
    ):
        raise ValueError("Validation rows must be a nonnegative integer.")

    with _lock:
        record = _registry.get(str(registry_id))

        if record is None:
            raise KeyError("Registered model was not found.")

        record["metrics"] = clean_metrics

        if validation_rows is not None:
            record["validation_rows"] = validation_rows

        if dataset_fingerprint is not None:
            record["dataset_fingerprint"] = dataset_fingerprint

        record["updated_at"] = _utc_now()

        return dict(record)


def activate_model(registry_id: str) -> dict[str, Any]:
    """
    Mark a registered model active.

    This registry does not automatically load or switch the live predictor.
    The application must connect the selected registry ID to its model loader.
    """
    with _lock:
        record = _registry.get(str(registry_id))

        if record is None:
            raise KeyError("Registered model was not found.")

        record["active"] = True
        record["updated_at"] = _utc_now()

        return dict(record)


def deactivate_model(registry_id: str) -> dict[str, Any]:
    """Deactivate a registered model without deleting its history."""
    with _lock:
        record = _registry.get(str(registry_id))

        if record is None:
            raise KeyError("Registered model was not found.")

        record["active"] = False
        record["updated_at"] = _utc_now()

        return dict(record)


def select_best_model(
    *,
    symbol: str | None = None,
    horizon_days: int | None = None,
    metric: str = "rmse",
    algorithm: str | None = None,
    require_validation_samples: int = 1,
) -> dict[str, Any] | None:
    """
    Select a registered model with the best recorded metric.

    Lower is better for error metrics. Higher is better for directional
    accuracy.

    Models with missing metrics or too few validation samples are excluded.
    Models are compared only when their recorded symbol and horizon match
    the requested scope.

    Returns None if no eligible model is available.
    """
    normalized_metric = metric.strip().lower()

    if normalized_metric not in _METRIC_DIRECTIONS:
        raise ValueError(
            "Unsupported metric. Choose from: "
            + ", ".join(_METRIC_DIRECTIONS)
        )

    if (
        isinstance(require_validation_samples, bool)
        or not isinstance(require_validation_samples, int)
        or require_validation_samples < 1
    ):
        raise ValueError(
            "require_validation_samples must be a positive integer."
        )

    normalized_symbol = symbol.strip().upper() if symbol else None
    normalized_algorithm = algorithm.strip().lower() if algorithm else None

    with _lock:
        candidates = []

        for record in _registry.values():
            if normalized_symbol and record.get("symbol") != normalized_symbol:
                continue

            if (
                horizon_days is not None
                and record.get("horizon_days") != horizon_days
            ):
                continue

            if (
                normalized_algorithm
                and record.get("algorithm", "").lower()
                != normalized_algorithm
            ):
                continue

            validation_rows = record.get("validation_rows")

            if (
                validation_rows is None
                or validation_rows < require_validation_samples
            ):
                continue

            value = record.get("metrics", {}).get(normalized_metric)

            if value is None:
                continue

            candidates.append((float(value), dict(record)))

    if not candidates:
        return None

    reverse = _METRIC_DIRECTIONS[normalized_metric] == "higher"

    candidates.sort(
        key=lambda item: item[0],
        reverse=reverse,
    )

    best_value, best_record = candidates[0]

    return {
        **best_record,
        "selection_metric": normalized_metric,
        "selection_metric_value": best_value,
        "selection_note": (
            "Selected using recorded validation metrics only. "
            "This result is not a guarantee of future performance."
        ),
    }


def delete_model(registry_id: str) -> bool:
    """Remove a registry entry. Returns False if it did not exist."""
    with _lock:
        return _registry.pop(str(registry_id), None) is not None


def clear_registry() -> None:
    """Clear the in-memory registry, primarily for isolated tests."""
    with _lock:
        _registry.clear()