"""
Market Plus AI — AI Prediction Engine
File: backend/predictor.py
Version: 3.0.0

Features:
- Random Forest prediction model.
- Linear Regression prediction model.
- LSTM + Transformer Encoder deep-learning model.
- 1, 7 and 30 trading-day prediction horizons.
- Technical indicators and historical market features.
- Chronological, horizon-aware train/test evaluation.
- Training-only neural feature and target scaling.
- Early stopping and full-training-data neural refit.
- RMSE and MAE evaluation metrics.
- Risk assessment and prediction explanations.
- Optional persistence through the existing predictions table.
- Prediction history retrieval.
- Safe handling of missing and invalid market data.

Important:
Predictions are estimates generated from historical market data.
They are not guaranteed future prices or investment advice.
"""

from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
import pandas as pd

from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

# PyTorch is needed only when the neural model is selected.
try:
    import torch
    from torch import nn
    from torch.utils.data import DataLoader, TensorDataset

except Exception:
    torch = None
    nn = None
    DataLoader = None
    TensorDataset = None

from backend.data_fetcher import get_historical_data, get_stock_info
from backend.database import get_db, utc_now

from backend.validation import (
    validate_stock_symbol,
    validate_prediction_horizon,
    validate_risk_category,
)


logger = logging.getLogger(__name__)


# =========================================================
# 1. CONFIGURATION
# =========================================================

DEFAULT_HORIZONS = (1, 7, 30)

MINIMUM_ROWS = 120
MINIMUM_TRAIN_ROWS = 60

TEST_RATIO = 0.20

DEFAULT_MODEL = "Random Forest"

SUPPORTED_MODELS = (
    "Random Forest",
    "Linear Regression",
    "LSTM + Transformer",
)

SEQUENCE_LENGTH = 30

NEURAL_EPOCHS = 35
NEURAL_BATCH_SIZE = 32
NEURAL_LEARNING_RATE = 0.001
NEURAL_PATIENCE = 7
NEURAL_RANDOM_SEED = 42

FEATURE_COLUMNS = [
    "return_1d",
    "return_5d",
    "return_10d",
    "volatility_10d",
    "volatility_20d",
    "ma10_distance",
    "ma20_distance",
    "ma50_distance",
    "rsi14",
    "macd",
    "macd_signal",
    "high_low_range",
    "volume_change",
]


class PredictionError(Exception):
    """Raised when a valid prediction cannot be generated."""


# =========================================================
# 2. GENERAL HELPERS
# =========================================================

def _safe_float(
    value: Any,
    default: float | None = None,
):
    """Convert a value to a finite float."""

    try:
        result = float(value)

        if not math.isfinite(result):
            return default

        return result

    except (TypeError, ValueError, OverflowError):
        return default


def _safe_int(
    value: Any,
    default: int = 0,
) -> int:
    """Convert a value to an integer safely."""

    try:
        return int(value)

    except (TypeError, ValueError, OverflowError):
        return default


def _safe_text(
    value: Any,
    default: str = "",
) -> str:
    """Convert a value to clean text."""

    if value is None:
        return default

    result = str(value).strip()

    return result if result else default


def _normalise_symbol(symbol: str) -> str:
    """Validate and normalize a ticker symbol."""

    try:
        result = validate_stock_symbol(symbol)

        if isinstance(result, tuple):
            is_valid, cleaned_value = result

            if not is_valid:
                raise ValueError(cleaned_value)

            symbol = cleaned_value

        elif isinstance(result, str):
            symbol = result

        normalized = _safe_text(symbol).upper()

        if not normalized:
            raise ValueError("Enter a stock symbol.")

        return normalized

    except Exception as exc:
        raise PredictionError(
            f"Invalid stock symbol: {exc}"
        ) from exc


def _normalise_horizon(horizon_days: int) -> int:
    """Validate the requested prediction horizon."""

    try:
        result = validate_prediction_horizon(horizon_days)

        if isinstance(result, tuple):
            is_valid, cleaned_value = result

            if not is_valid:
                raise ValueError(cleaned_value)

            horizon_days = cleaned_value

        elif isinstance(result, bool):

            if not result:
                raise ValueError(
                    "Invalid prediction horizon."
                )

        elif result is not None:
            horizon_days = result

        horizon = _safe_int(horizon_days, -1)

        if horizon not in DEFAULT_HORIZONS:
            raise ValueError(
                "Supported prediction horizons are "
                "1, 7 and 30 days."
            )

        return horizon

    except Exception as exc:
        raise PredictionError(
            f"Invalid prediction horizon: {exc}"
        ) from exc


def _normalise_risk_category(
    risk_category: str,
) -> str:
    """Validate and normalize the selected risk category."""

    try:
        result = validate_risk_category(risk_category)

        if isinstance(result, tuple):
            is_valid, cleaned_value = result

            if not is_valid:
                raise ValueError(cleaned_value)

            risk_category = cleaned_value

        elif isinstance(result, str):
            risk_category = result

        category = _safe_text(
            risk_category
        ).lower()

        if category not in ("low", "middle", "high"):
            raise ValueError(
                "Risk category must be low, middle or high."
            )

        return category

    except Exception as exc:
        raise PredictionError(
            f"Invalid risk category: {exc}"
        ) from exc


def _normalise_model_name(
    model_name: str | None,
) -> str:
    """Validate the requested machine-learning model."""

    if model_name is None or not str(model_name).strip():
        return DEFAULT_MODEL

    requested = str(model_name).strip().lower()

    aliases = {
        "random forest": "Random Forest",
        "randomforest": "Random Forest",
        "rf": "Random Forest",

        "linear regression": "Linear Regression",
        "linear": "Linear Regression",
        "lr": "Linear Regression",

        "lstm + transformer": "LSTM + Transformer",
        "lstm transformer": "LSTM + Transformer",
        "lstm-transformer": "LSTM + Transformer",
        "lstm_transformer": "LSTM + Transformer",
        "advanced": "LSTM + Transformer",
    }

    normalized = aliases.get(requested)

    if normalized not in SUPPORTED_MODELS:
        raise PredictionError(
            "Choose Random Forest, Linear Regression "
            "or LSTM + Transformer."
        )

    if normalized == "LSTM + Transformer" and torch is None:
        raise PredictionError(
            "LSTM + Transformer requires PyTorch. "
            "Install it using "
            "'python -m pip install torch'."
        )

    return normalized


# =========================================================
# 3. HISTORICAL DATA NORMALIZATION
# =========================================================

def _normalise_history(
    history: Any,
) -> pd.DataFrame:
    """
    Normalize Yahoo Finance historical data.

    Expected columns:
    Open, High, Low, Close, Volume

    Supports DataFrames with MultiIndex columns.
    """

    if history is None:
        raise PredictionError(
            "Historical market data is unavailable."
        )

    if not isinstance(history, pd.DataFrame):
        raise PredictionError(
            "The historical data provider returned "
            "an invalid format."
        )

    if history.empty:
        raise PredictionError(
            "No historical market data was found."
        )

    data = history.copy()

    if isinstance(data.columns, pd.MultiIndex):

        flattened_columns = []

        for column in data.columns:

            parts = [
                str(part)
                for part in column
                if str(part).strip()
            ]

            flattened_columns.append(
                parts[0] if parts else ""
            )

        data.columns = flattened_columns

    data.columns = [
        str(column).strip().lower().replace(" ", "_")
        for column in data.columns
    ]

    data = data.loc[
        :,
        ~data.columns.duplicated()
    ]

    required_columns = [
        "close",
        "high",
        "low",
        "volume",
    ]

    missing = [
        column
        for column in required_columns
        if column not in data.columns
    ]

    if missing:
        raise PredictionError(
            "Historical data is missing required columns: "
            + ", ".join(missing)
        )

    try:
        data.index = pd.to_datetime(
            data.index,
            errors="coerce",
            utc=True,
        )

    except Exception as exc:
        raise PredictionError(
            "Could not interpret historical market dates."
        ) from exc

    data = data.loc[
        ~data.index.isna()
    ].copy()

    data = data.sort_index()

    if getattr(data.index, "tz", None) is not None:
        data.index = data.index.tz_convert(None)

    numeric_columns = [
        "open",
        "high",
        "low",
        "close",
        "volume",
    ]

    for column in numeric_columns:

        if column in data.columns:

            data[column] = pd.to_numeric(
                data[column],
                errors="coerce",
            )

    data = data.replace(
        [np.inf, -np.inf],
        np.nan,
    )

    data = data.dropna(
        subset=[
            "close",
            "high",
            "low",
            "volume",
        ]
    )

    data = data[data["close"] > 0]
    data = data[data["high"] > 0]
    data = data[data["low"] > 0]
    data = data[data["volume"] >= 0]

    data = data[
        ~data.index.duplicated(keep="last")
    ]

    if data.empty:
        raise PredictionError(
            "No valid historical price records remain "
            "after cleaning."
        )

    return data


# =========================================================
# 4. TECHNICAL INDICATORS
# =========================================================

def _calculate_rsi(
    close: pd.Series,
    period: int = 14,
) -> pd.Series:
    """Calculate the Relative Strength Index."""

    delta = close.diff()

    gains = delta.clip(lower=0)
    losses = -delta.clip(upper=0)

    average_gain = gains.ewm(
        alpha=1 / period,
        min_periods=period,
        adjust=False,
    ).mean()

    average_loss = losses.ewm(
        alpha=1 / period,
        min_periods=period,
        adjust=False,
    ).mean()

    relative_strength = (
        average_gain
        / average_loss.replace(0, np.nan)
    )

    rsi = 100 - (
        100 / (1 + relative_strength)
    )

    rsi = rsi.mask(
        (average_loss == 0) & (average_gain > 0),
        100,
    )

    rsi = rsi.mask(
        (average_gain == 0) & (average_loss > 0),
        0,
    )

    rsi = rsi.mask(
        (average_gain == 0) & (average_loss == 0),
        50,
    )

    return rsi


def build_features(
    history: pd.DataFrame,
) -> pd.DataFrame:
    """
    Build model features from cleaned OHLCV data.

    Features use current and previous observations only.
    """

    data = _normalise_history(history)

    close = data["close"].astype(float)
    high = data["high"].astype(float)
    low = data["low"].astype(float)
    volume = data["volume"].astype(float)

    features = pd.DataFrame(
        index=data.index
    )

    features["return_1d"] = close.pct_change(1)
    features["return_5d"] = close.pct_change(5)
    features["return_10d"] = close.pct_change(10)

    daily_returns = close.pct_change()

    features["volatility_10d"] = (
        daily_returns.rolling(10).std()
    )

    features["volatility_20d"] = (
        daily_returns.rolling(20).std()
    )

    ma10 = close.rolling(10).mean()
    ma20 = close.rolling(20).mean()
    ma50 = close.rolling(50).mean()

    features["ma10_distance"] = (
        close / ma10 - 1
    )

    features["ma20_distance"] = (
        close / ma20 - 1
    )

    features["ma50_distance"] = (
        close / ma50 - 1
    )

    features["rsi14"] = _calculate_rsi(
        close,
        14,
    )

    ema12 = close.ewm(
        span=12,
        adjust=False,
    ).mean()

    ema26 = close.ewm(
        span=26,
        adjust=False,
    ).mean()

    macd = ema12 - ema26

    macd_signal = macd.ewm(
        span=9,
        adjust=False,
    ).mean()

    features["macd"] = macd / close
    features["macd_signal"] = macd_signal / close

    features["high_low_range"] = (
        (high - low) / close
    )

    average_volume = volume.rolling(20).mean()

    features["volume_change"] = (
        volume / average_volume.replace(0, np.nan) - 1
    )

    features = features.replace(
        [np.inf, -np.inf],
        np.nan,
    )

    return features


# =========================================================
# 5. LSTM + TRANSFORMER ARCHITECTURE
# =========================================================

if nn is not None:

    class _LSTMTransformerNetwork(nn.Module):
        """
        LSTM encoder followed by Transformer self-attention.

        LSTM:
            Learns sequential price-feature patterns.

        Transformer:
            Learns relationships between time steps
            using multi-head self-attention.

        Output:
            One regression value representing the
            predicted future closing price.
        """

        def __init__(
            self,
            input_size: int,
        ):
            super().__init__()

            self.lstm = nn.LSTM(
                input_size=input_size,
                hidden_size=64,
                num_layers=1,
                batch_first=True,
            )

            transformer_layer = (
                nn.TransformerEncoderLayer(
                    d_model=64,
                    nhead=4,
                    dim_feedforward=128,
                    dropout=0.10,
                    batch_first=True,
                    activation="gelu",
                    norm_first=True,
                )
            )

            self.transformer = nn.TransformerEncoder(
                transformer_layer,
                num_layers=2,
            )

            self.norm = nn.LayerNorm(64)

            self.head = nn.Sequential(
                nn.Linear(64, 32),
                nn.GELU(),
                nn.Dropout(0.10),
                nn.Linear(32, 1),
            )

        def forward(self, inputs):

            sequence, _ = self.lstm(inputs)

            attended = self.transformer(sequence)

            last_step = attended[:, -1, :]

            normalized = self.norm(last_step)

            return self.head(
                normalized
            ).squeeze(-1)


# =========================================================
# 6. LSTM + TRANSFORMER REGRESSOR
# =========================================================

class LSTMTransformerRegressor:
    """
    Chronological sliding-window regression model.

    Important improvements:
    - Scalers are fitted using training observations only
      during validation.
    - Validation windows retain earlier training context.
    - A purge gap separates training labels from validation.
    - Early stopping chooses a training duration.
    - The final network is refitted using all available
      training observations for the selected duration.
    """

    def __init__(self):

        if torch is None or nn is None:
            raise PredictionError(
                "PyTorch is not installed."
            )

        self.device = torch.device("cpu")

        self.feature_scaler = StandardScaler()
        self.target_scaler = StandardScaler()

        self.network = None

        self.feature_count = None

        self.is_fitted = False

        self.training_epochs = 0

        self.best_validation_loss = None

    @staticmethod
    def _arrays(
        X,
        y=None,
    ):
        """Validate feature and target arrays."""

        values = np.asarray(
            X,
            dtype=np.float32,
        )

        if values.ndim != 2:
            raise ValueError(
                "Neural model features must be a 2D matrix."
            )

        if not np.isfinite(values).all():
            raise ValueError(
                "Neural model features contain invalid values."
            )

        targets = None

        if y is not None:

            targets = np.asarray(
                y,
                dtype=np.float32,
            ).reshape(-1)

            if len(targets) != len(values):
                raise ValueError(
                    "Neural model targets are misaligned."
                )

            if not np.isfinite(targets).all():
                raise ValueError(
                    "Neural model targets contain invalid values."
                )

        return values, targets

    @staticmethod
    def _sequences(values):
        """
        Convert a 2D feature matrix into rolling sequences.

        Each sequence contains SEQUENCE_LENGTH observations.
        """

        if len(values) < SEQUENCE_LENGTH:
            raise ValueError(
                f"At least {SEQUENCE_LENGTH} feature rows "
                "are required."
            )

        return np.stack(
            [
                values[
                    i - SEQUENCE_LENGTH + 1:i + 1
                ]
                for i in range(
                    SEQUENCE_LENGTH - 1,
                    len(values),
                )
            ]
        ).astype(np.float32)

    def _build_network(self):
        """Create a fresh neural network."""

        return _LSTMTransformerNetwork(
            self.feature_count
        ).to(self.device)

    def _train_epochs(
        self,
        network,
        sequences,
        targets,
        epochs,
    ):
        """Train a network for a fixed number of epochs."""

        x_tensor = torch.from_numpy(
            sequences
        ).to(self.device)

        y_tensor = torch.from_numpy(
            targets
        ).to(self.device)

        dataset = TensorDataset(
            x_tensor,
            y_tensor,
        )

        loader = DataLoader(
            dataset,
            batch_size=NEURAL_BATCH_SIZE,
            shuffle=True,
        )

        optimizer = torch.optim.AdamW(
            network.parameters(),
            lr=NEURAL_LEARNING_RATE,
            weight_decay=1e-4,
        )

        loss_fn = nn.HuberLoss()

        network.train()

        for _ in range(epochs):

            for batch_x, batch_y in loader:

                optimizer.zero_grad(
                    set_to_none=True
                )

                predictions = network(batch_x)

                loss = loss_fn(
                    predictions,
                    batch_y,
                )

                if not torch.isfinite(loss):
                    raise ValueError(
                        "Neural training produced a non-finite loss."
                    )

                loss.backward()

                torch.nn.utils.clip_grad_norm_(
                    network.parameters(),
                    1.0,
                )

                optimizer.step()

        network.eval()

        return network

    def fit(
        self,
        X,
        y,
        purge_rows: int = 0,
    ):
        """
        Train the neural model.

        purge_rows:
            Number of observations excluded between the
            inner training and validation targets to reduce
            overlapping-horizon leakage.
        """

        values, targets = self._arrays(
            X,
            y,
        )

        if len(values) < SEQUENCE_LENGTH + 20:
            raise ValueError(
                "Not enough observations for LSTM + Transformer."
            )

        self.feature_count = values.shape[1]

        total_rows = len(values)

        validation_start = int(
            total_rows * 0.85
        )

        validation_start = max(
            validation_start,
            SEQUENCE_LENGTH + 10,
        )

        if validation_start >= total_rows:
            raise ValueError(
                "Not enough validation observations."
            )

        purge_rows = max(
            0,
            _safe_int(purge_rows),
        )

        train_end = validation_start - purge_rows

        if train_end < SEQUENCE_LENGTH + 10:
            raise ValueError(
                "Not enough training observations after "
                "the validation purge gap."
            )

        # -------------------------------------------------
        # STEP 1: FIT SCALERS USING INNER TRAINING DATA ONLY
        # -------------------------------------------------

        validation_feature_scaler = StandardScaler()

        validation_target_scaler = StandardScaler()

        validation_feature_scaler.fit(
            values[:train_end]
        )

        training_target_values = targets[
            SEQUENCE_LENGTH - 1:train_end
        ]

        if len(training_target_values) < 10:
            raise ValueError(
                "Not enough training targets for neural scaling."
            )

        validation_target_scaler.fit(
            training_target_values.reshape(-1, 1)
        )

        scaled_validation_features = (
            validation_feature_scaler.transform(
                values
            ).astype(np.float32)
        )

        scaled_validation_targets = (
            validation_target_scaler.transform(
                targets.reshape(-1, 1)
            ).reshape(-1).astype(np.float32)
        )

        all_sequences = self._sequences(
            scaled_validation_features
        )

        all_sequence_targets = (
            scaled_validation_targets[
                SEQUENCE_LENGTH - 1:
            ]
        )

        # Sequence target positions:
        # SEQUENCE_LENGTH - 1, ..., total_rows - 1.

        training_sequence_count = (
            train_end - SEQUENCE_LENGTH + 1
        )

        validation_sequence_start = (
            validation_start - SEQUENCE_LENGTH + 1
        )

        if training_sequence_count < 10:
            raise ValueError(
                "Not enough training sequences."
            )

        x_train = all_sequences[
            :training_sequence_count
        ]

        y_train = all_sequence_targets[
            :training_sequence_count
        ]

        x_validation = all_sequences[
            validation_sequence_start:
        ]

        y_validation = scaled_validation_targets[
            validation_start:
        ]

        if len(x_validation) < 1:
            raise ValueError(
                "Not enough neural validation sequences."
            )

        if len(x_validation) != len(y_validation):
            raise ValueError(
                "Neural validation sequences are misaligned."
            )

        # -------------------------------------------------
        # STEP 2: CHRONOLOGICAL VALIDATION
        # -------------------------------------------------

        torch.manual_seed(
            NEURAL_RANDOM_SEED
        )

        np.random.seed(
            NEURAL_RANDOM_SEED
        )

        validation_network = self._build_network()

        optimizer = torch.optim.AdamW(
            validation_network.parameters(),
            lr=NEURAL_LEARNING_RATE,
            weight_decay=1e-4,
        )

        loss_fn = nn.HuberLoss()

        train_tensor = torch.from_numpy(
            x_train
        ).to(self.device)

        target_tensor = torch.from_numpy(
            y_train
        ).to(self.device)

        validation_x_tensor = torch.from_numpy(
            x_validation
        ).to(self.device)

        validation_y_tensor = torch.from_numpy(
            y_validation
        ).to(self.device)

        loader = DataLoader(
            TensorDataset(
                train_tensor,
                target_tensor,
            ),
            batch_size=NEURAL_BATCH_SIZE,
            shuffle=True,
        )

        best_loss = float("inf")

        best_epoch = 0

        best_state = None

        patience_count = 0

        for epoch in range(NEURAL_EPOCHS):

            validation_network.train()

            for batch_x, batch_y in loader:

                optimizer.zero_grad(
                    set_to_none=True
                )

                predictions = validation_network(
                    batch_x
                )

                loss = loss_fn(
                    predictions,
                    batch_y,
                )

                if not torch.isfinite(loss):
                    raise ValueError(
                        "Neural training produced an invalid loss."
                    )

                loss.backward()

                torch.nn.utils.clip_grad_norm_(
                    validation_network.parameters(),
                    1.0,
                )

                optimizer.step()

            validation_network.eval()

            with torch.no_grad():

                validation_predictions = (
                    validation_network(
                        validation_x_tensor
                    )
                )

                validation_loss = float(
                    loss_fn(
                        validation_predictions,
                        validation_y_tensor,
                    ).item()
                )

            if not math.isfinite(validation_loss):
                raise ValueError(
                    "Neural validation loss is invalid."
                )

            if validation_loss < best_loss - 1e-6:

                best_loss = validation_loss

                best_epoch = epoch + 1

                best_state = {
                    key: value.detach().cpu().clone()
                    for key, value in (
                        validation_network.state_dict().items()
                    )
                }

                patience_count = 0

            else:
                patience_count += 1

            if patience_count >= NEURAL_PATIENCE:
                break

        if best_state is None or best_epoch < 1:
            raise ValueError(
                "LSTM + Transformer training did not converge."
            )

        # -------------------------------------------------
        # STEP 3: REFIT SCALERS USING ALL AVAILABLE
        # SUPERVISED TRAINING OBSERVATIONS
        # -------------------------------------------------

        self.feature_scaler = StandardScaler()

        self.target_scaler = StandardScaler()

        self.feature_scaler.fit(values)

        final_target_values = targets[
            SEQUENCE_LENGTH - 1:
        ]

        self.target_scaler.fit(
            final_target_values.reshape(-1, 1)
        )

        scaled_features = (
            self.feature_scaler.transform(
                values
            ).astype(np.float32)
        )

        scaled_targets = (
            self.target_scaler.transform(
                targets.reshape(-1, 1)
            ).reshape(-1).astype(np.float32)
        )

        final_sequences = self._sequences(
            scaled_features
        )

        final_sequence_targets = scaled_targets[
            SEQUENCE_LENGTH - 1:
        ]

        # -------------------------------------------------
        # STEP 4: TRAIN FINAL NETWORK USING ALL TRAINING
        # OBSERVATIONS FOR THE SELECTED NUMBER OF EPOCHS
        # -------------------------------------------------

        torch.manual_seed(
            NEURAL_RANDOM_SEED
        )

        np.random.seed(
            NEURAL_RANDOM_SEED
        )

        self.network = self._build_network()

        self.network = self._train_epochs(
            self.network,
            final_sequences,
            final_sequence_targets,
            best_epoch,
        )

        self.training_epochs = best_epoch

        self.best_validation_loss = best_loss

        self.is_fitted = True

        return self

    def predict(self, X):
        """Predict one output for each complete input sequence."""

        if not self.is_fitted or self.network is None:
            raise ValueError(
                "LSTM + Transformer has not been trained."
            )

        values, _ = self._arrays(X)

        if values.shape[1] != self.feature_count:
            raise ValueError(
                "Prediction feature count does not match training."
            )

        scaled = self.feature_scaler.transform(
            values
        ).astype(np.float32)

        sequences = self._sequences(
            scaled
        )

        tensor = torch.from_numpy(
            sequences
        ).to(self.device)

        self.network.eval()

        with torch.no_grad():

            scaled_predictions = (
                self.network(tensor)
                .cpu()
                .numpy()
                .reshape(-1, 1)
            )

        predictions = (
            self.target_scaler.inverse_transform(
                scaled_predictions
            ).reshape(-1)
        )

        if not np.isfinite(predictions).all():
            raise ValueError(
                "Neural model returned invalid predictions."
            )

        return predictions


# =========================================================
# 7. MODEL CREATION
# =========================================================

def _make_model(
    model_name: str,
):
    """Create the selected machine-learning model."""

    model_name = _normalise_model_name(
        model_name
    )

    if model_name == "Linear Regression":

        return Pipeline(
            steps=[
                (
                    "scaler",
                    StandardScaler(),
                ),
                (
                    "model",
                    LinearRegression(),
                ),
            ]
        )

    if model_name == "LSTM + Transformer":
        return LSTMTransformerRegressor()

    return RandomForestRegressor(
        n_estimators=200,
        max_depth=8,
        min_samples_leaf=3,
        max_features=0.9,
        random_state=42,
        n_jobs=-1,
    )


# =========================================================
# 8. TRAINING DATA PREPARATION
# =========================================================

def _prepare_training_data(
    history: pd.DataFrame,
    horizon_days: int,
):
    """
    Prepare chronological supervised learning data.

    Target:
        Closing price after the requested number of
        trading observations.

    The horizon represents trading observations,
    not guaranteed calendar-day delivery.
    """

    cleaned = _normalise_history(
        history
    )

    features = build_features(
        cleaned
    )

    close = cleaned["close"].astype(float)

    target = close.shift(
        -horizon_days
    )

    dataset = features.copy()

    dataset["target"] = target

    dataset = dataset.replace(
        [np.inf, -np.inf],
        np.nan,
    )

    dataset = dataset.dropna(
        subset=FEATURE_COLUMNS + ["target"]
    )

    if len(dataset) < MINIMUM_ROWS:

        raise PredictionError(
            f"Insufficient clean training data. "
            f"At least {MINIMUM_ROWS} usable rows are required; "
            f"only {len(dataset)} are available."
        )

    X = dataset[
        FEATURE_COLUMNS
    ].astype(float)

    y = dataset[
        "target"
    ].astype(float)

    if not np.isfinite(
        X.to_numpy()
    ).all():

        raise PredictionError(
            "Training features contain invalid numeric values."
        )

    if not np.isfinite(
        y.to_numpy()
    ).all():

        raise PredictionError(
            "Training targets contain invalid numeric values."
        )

    return X, y, features, cleaned


# =========================================================
# 9. MODEL EVALUATION
# =========================================================

def _evaluate_model(
    X: pd.DataFrame,
    y: pd.Series,
    model_name: str,
    horizon_days: int = 1,
):
    """
    Chronological, horizon-aware holdout evaluation.

    The final training observations are purged so that
    their future target prices do not overlap the test period.

    The test period is never randomly shuffled.
    """

    total_rows = len(X)

    split_index = int(
        total_rows * (1 - TEST_RATIO)
    )

    horizon_days = max(
        1,
        _safe_int(horizon_days, 1),
    )

    # Remove training observations whose future targets
    # would overlap the beginning of the test period.
    train_end = split_index - horizon_days

    if train_end < MINIMUM_TRAIN_ROWS:

        raise PredictionError(
            "Not enough training observations after "
            "the prediction-horizon purge."
        )

    if total_rows - split_index < 10:

        raise PredictionError(
            "Not enough test observations for evaluation."
        )

    X_train = X.iloc[:train_end]

    y_train = y.iloc[:train_end]

    X_test = X.iloc[split_index:]

    y_test = y.iloc[split_index:]

    model = _make_model(
        model_name
    )

    try:

        if model_name == "LSTM + Transformer":

            model.fit(
                X_train,
                y_train,
                purge_rows=horizon_days,
            )

            # Include earlier observations as sequence context.
            # This produces exactly one prediction per test row.
            context_start = max(
                0,
                split_index - SEQUENCE_LENGTH + 1,
            )

            predictions = model.predict(
                X.iloc[context_start:]
            )

        else:

            model.fit(
                X_train,
                y_train,
            )

            predictions = model.predict(
                X_test
            )

    except Exception as exc:

        logger.exception(
            "Model evaluation failed for %s",
            model_name,
        )

        raise PredictionError(
            f"Could not evaluate the {model_name} model: {exc}"
        ) from exc

    predictions = np.asarray(
        predictions,
        dtype=float,
    ).reshape(-1)

    if len(predictions) != len(y_test):

        raise PredictionError(
            "The model returned a different number of "
            "predictions than the evaluation test rows."
        )

    if not np.isfinite(
        predictions
    ).all():

        raise PredictionError(
            "Model evaluation produced invalid predictions."
        )

    rmse = float(
        np.sqrt(
            mean_squared_error(
                y_test,
                predictions,
            )
        )
    )

    mae = float(
        mean_absolute_error(
            y_test,
            predictions,
        )
    )

    if (
        not math.isfinite(rmse)
        or not math.isfinite(mae)
    ):

        raise PredictionError(
            "Model evaluation produced invalid metrics."
        )

    return {
        "model": model,
        "rmse": rmse,
        "mae": mae,
        "test_rows": len(X_test),
        "train_rows": len(X_train),
        "purged_rows": horizon_days,
    }


# =========================================================
# 10. RISK ASSESSMENT
# =========================================================

def _calculate_risk(
    history: pd.DataFrame,
    predicted_change_percent: float,
    profile_category: str,
):
    """
    Estimate forecast risk using historical volatility.

    This is a descriptive risk indicator, not a guarantee.
    """

    close = history["close"].astype(float)

    returns = close.pct_change().dropna()

    volatility = _safe_float(
        returns.tail(20).std(),
        0.0,
    )

    annualized_volatility = (
        volatility * math.sqrt(252) * 100
    )

    absolute_change = abs(
        _safe_float(
            predicted_change_percent,
            0.0,
        )
    )

    score = min(
        100.0,
        (
            annualized_volatility * 0.65
            + absolute_change * 0.35
        ),
    )

    if score < 15:
        risk_level = "Low"

    elif score < 30:
        risk_level = "Moderate"

    else:
        risk_level = "High"

    profile_guidance = {
        "low": (
            "Your selected profile is conservative. "
            "Review downside risk carefully before making decisions."
        ),

        "middle": (
            "Your selected profile is balanced. "
            "Consider both potential gains and possible losses."
        ),

        "high": (
            "Your selected profile accepts higher risk. "
            "High volatility can still result in substantial losses."
        ),
    }

    return {
        "level": risk_level,

        "score": round(
            score,
            2,
        ),

        "historical_volatility_percent": round(
            annualized_volatility,
            2,
        ),

        "profile_category": profile_category,

        "profile_guidance": profile_guidance[
            profile_category
        ],

        "description": (
            "Risk is estimated from recent historical volatility "
            "and the magnitude of the model's predicted price change."
        ),
    }


# =========================================================
# 11. EXPLANATION GENERATION
# =========================================================

def _build_explanation(
    predicted_change_percent: float,
    risk: dict,
    model_name: str,
    horizon_days: int,
):
    """Create a readable explanation for the prediction."""

    change = _safe_float(
        predicted_change_percent,
        0.0,
    )

    if change > 0.05:
        direction = "an upward movement"

    elif change < -0.05:
        direction = "a downward movement"

    else:
        direction = "a relatively stable movement"

    risk_level = risk.get(
        "level",
        "Unknown",
    )

    return (
        f"The {model_name} model estimates {direction} "
        f"over approximately {horizon_days} trading day(s). "
        f"The estimated percentage change is {change:.2f}%. "
        f"The calculated risk level is {risk_level}. "
        "This result is based on historical price patterns and "
        "technical indicators. Actual market prices may differ."
    )


# =========================================================
# 12. MAIN PREDICTION FUNCTION
# =========================================================

def generate_prediction(
    symbol: str,
    horizon_days: int = 1,
    risk_category: str = "middle",
    model_name: str = DEFAULT_MODEL,
    save_to_database: bool = False,
):
    """
    Generate an AI-assisted stock price prediction.

    Parameters:
        symbol:
            Yahoo Finance ticker, for example TCS.NS.

        horizon_days:
            1, 7 or 30 trading observations.

        risk_category:
            low, middle or high.

        model_name:
            Random Forest, Linear Regression or
            LSTM + Transformer.

        save_to_database:
            Persistence is handled by the authenticated
            Flask route to avoid duplicate records.

    Returns:
        Dictionary containing prediction, evaluation and risk data.
    """

    symbol = _normalise_symbol(
        symbol
    )

    horizon_days = _normalise_horizon(
        horizon_days
    )

    risk_category = _normalise_risk_category(
        risk_category
    )

    model_name = _normalise_model_name(
        model_name
    )

    logger.info(
        "Generating prediction: symbol=%s horizon=%s model=%s",
        symbol,
        horizon_days,
        model_name,
    )

    # -----------------------------------------------------
    # FETCH HISTORICAL MARKET DATA
    # -----------------------------------------------------

    try:

        raw_history = get_historical_data(
            symbol,
            period="2y",
            interval="1d",
        )

    except Exception as exc:

        logger.exception(
            "Historical data request failed for %s",
            symbol,
        )

        raise PredictionError(
            f"Could not retrieve historical data for {symbol}: {exc}"
        ) from exc

    cleaned_history = _normalise_history(
        raw_history
    )

    # -----------------------------------------------------
    # PREPARE TRAINING DATA
    # -----------------------------------------------------

    (
        X,
        y,
        all_features,
        cleaned_history,
    ) = _prepare_training_data(
        cleaned_history,
        horizon_days,
    )

    # -----------------------------------------------------
    # EVALUATE MODEL
    # -----------------------------------------------------

    evaluation = _evaluate_model(
        X,
        y,
        model_name,
        horizon_days,
    )

    # -----------------------------------------------------
    # TRAIN FINAL MODEL
    # -----------------------------------------------------

    final_model = _make_model(
        model_name
    )

    try:

        final_model.fit(
            X,
            y,
        )

        latest_features = (
            all_features[FEATURE_COLUMNS]
            .replace(
                [np.inf, -np.inf],
                np.nan,
            )
            .dropna()
        )

        if latest_features.empty:

            raise PredictionError(
                "The latest market data does not contain "
                "enough valid technical indicators."
            )

        if model_name == "LSTM + Transformer":

            if len(latest_features) < SEQUENCE_LENGTH:

                raise PredictionError(
                    "Not enough recent feature history for "
                    "LSTM + Transformer."
                )

            model_prediction = float(
                final_model.predict(
                    latest_features.tail(
                        SEQUENCE_LENGTH
                    )
                )[-1]
            )

        else:

            latest_row = latest_features.iloc[[-1]]

            model_prediction = float(
                final_model.predict(
                    latest_row
                )[0]
            )

    except PredictionError:
        raise

    except Exception as exc:

        logger.exception(
            "Final prediction failed for %s",
            symbol,
        )

        raise PredictionError(
            f"Could not generate the prediction: {exc}"
        ) from exc

    if (
        not math.isfinite(model_prediction)
        or model_prediction <= 0
    ):

        raise PredictionError(
            "The model returned an invalid predicted price."
        )

    # -----------------------------------------------------
    # CURRENT MARKET PRICE
    # -----------------------------------------------------

    historical_reference = _safe_float(
        cleaned_history["close"].iloc[-1]
    )

    if (
        historical_reference is None
        or historical_reference <= 0
    ):

        raise PredictionError(
            "The latest historical closing price is invalid."
        )

    quote = {}

    try:

        quote = get_stock_info(
            symbol
        ) or {}

    except Exception:

        logger.warning(
            "Could not retrieve a current quote for %s; "
            "using the latest historical close.",
            symbol,
        )

    quote_price = _safe_float(
        quote.get("last_price")
    )

    current_price = (
        quote_price
        if quote_price is not None and quote_price > 0
        else historical_reference
    )

    # -----------------------------------------------------
    # ADJUST PREDICTION TO CURRENT QUOTE
    # -----------------------------------------------------

    predicted_price = (
        model_prediction
        + (
            current_price
            - historical_reference
        )
    )

    if (
        not math.isfinite(predicted_price)
        or predicted_price <= 0
    ):

        raise PredictionError(
            "The adjusted predicted price is invalid."
        )

    predicted_change = (
        predicted_price
        - current_price
    )

    predicted_change_percent = (
        predicted_change / current_price
    ) * 100

    if not math.isfinite(
        predicted_change_percent
    ):

        raise PredictionError(
            "Could not calculate the predicted percentage change."
        )

    # -----------------------------------------------------
    # RISK ANALYSIS
    # -----------------------------------------------------

    risk = _calculate_risk(
        cleaned_history,
        predicted_change_percent,
        risk_category,
    )

    # -----------------------------------------------------
    # COMPANY AND CURRENCY INFORMATION
    # -----------------------------------------------------

    company_name = _safe_text(
        quote.get("name")
        or quote.get("company_name")
        or quote.get("short_name"),
        symbol,
    )

    currency = _safe_text(
        quote.get("currency"),
        "INR"
        if symbol.endswith((".NS", ".BO"))
        else "USD",
    )

    last_date = cleaned_history.index[-1]

    if hasattr(last_date, "isoformat"):

        last_historical_date = (
            last_date.isoformat()
        )

    else:

        last_historical_date = str(
            last_date
        )

    # -----------------------------------------------------
    # EXPLANATION
    # -----------------------------------------------------

    explanation = _build_explanation(
        predicted_change_percent,
        risk,
        model_name,
        horizon_days,
    )

    # -----------------------------------------------------
    # MODEL DETAILS
    # -----------------------------------------------------

    if model_name == "LSTM + Transformer":

        model_details = {
            "architecture": (
                "LSTM + Transformer Encoder"
            ),

            "sequence_length": SEQUENCE_LENGTH,

            "training_epochs": (
                final_model.training_epochs
            ),

            "device": "CPU",

            "validation_loss": (
                final_model.best_validation_loss
            ),

            "attention_heads": 4,

            "transformer_layers": 2,
        }

    else:

        model_details = {
            "architecture": model_name,
        }

    # -----------------------------------------------------
    # RESULT
    # -----------------------------------------------------

    result = {
        "symbol": symbol,

        "company_name": company_name,

        "currency": currency,

        "current_price": round(
            current_price,
            4,
        ),

        "predicted_price": round(
            predicted_price,
            4,
        ),

        "predicted_change": round(
            predicted_change,
            4,
        ),

        "predicted_change_percent": round(
            predicted_change_percent,
            4,
        ),

        "horizon_days": horizon_days,

        "horizon_label": (
            f"{horizon_days} trading day"
            if horizon_days == 1
            else f"{horizon_days} trading days"
        ),

        "model_name": model_name,

        "evaluation_rmse": round(
            evaluation["rmse"],
            4,
        ),

        "evaluation_mae": round(
            evaluation["mae"],
            4,
        ),

        "evaluation_test_rows": (
            evaluation["test_rows"]
        ),

        "evaluation_train_rows": (
            evaluation["train_rows"]
        ),

        "evaluation_purged_rows": (
            evaluation["purged_rows"]
        ),

        "model_details": model_details,

        "risk": risk,

        "risk_category": risk["level"].lower(),

        "profile_category": risk_category,

        "history_rows": len(
            cleaned_history
        ),

        "last_historical_date": (
            last_historical_date
        ),

        "explanation": explanation,

        "disclaimer": (
            "Market Plus AI provides experimental, AI-assisted "
            "estimates for educational and informational purposes. "
            "Predictions are not guaranteed. This application does "
            "not execute trades or provide financial advice. "
            "You may lose money when investing."
        ),

        "saved": False,

        "save_note": (
            "Prediction persistence is handled by the "
            "authenticated application route."
        ),
    }

    logger.info(
        "Prediction generated successfully: "
        "symbol=%s horizon=%s model=%s price=%.4f "
        "RMSE=%.4f MAE=%.4f",
        symbol,
        horizon_days,
        model_name,
        predicted_price,
        evaluation["rmse"],
        evaluation["mae"],
    )

    return result


# =========================================================
# 13. SAVE PREDICTION FOR A USER
# =========================================================

def save_prediction_for_user(
    prediction: dict,
    user_id: str,
) -> int:
    """
    Save a generated prediction with its complete lifecycle data.

    Preserves the existing predictions table structure and
    prediction-history tracking fields.
    """

    if not isinstance(prediction, dict):

        raise PredictionError(
            "Invalid prediction data."
        )

    user_id = _safe_text(
        user_id
    )

    if not user_id:

        raise PredictionError(
            "A valid authenticated user ID is required."
        )

    symbol = _normalise_symbol(
        prediction.get("symbol")
    )

    horizon_days = _normalise_horizon(
        prediction.get("horizon_days")
    )

    reference_price = _safe_float(
        prediction.get("current_price")
    )

    predicted_price = _safe_float(
        prediction.get("predicted_price")
    )

    predicted_change = _safe_float(
        prediction.get("predicted_change")
    )

    predicted_change_percent = _safe_float(
        prediction.get("predicted_change_percent")
    )

    evaluation_rmse = _safe_float(
        prediction.get("evaluation_rmse")
    )

    evaluation_mae = _safe_float(
        prediction.get("evaluation_mae")
    )

    if (
        reference_price is None
        or predicted_price is None
        or predicted_change is None
        or predicted_change_percent is None
        or reference_price <= 0
        or predicted_price <= 0
    ):

        raise PredictionError(
            "Prediction values are incomplete or invalid."
        )

    model_name = _normalise_model_name(
        prediction.get("model_name")
    )

    risk_category = _safe_text(
        prediction.get("risk_category"),
        "unknown",
    ).lower()

    explanation = _safe_text(
        prediction.get("explanation"),
        "AI-assisted stock price prediction.",
    )

    created_at = utc_now()

    try:

        created_datetime = datetime.fromisoformat(
            created_at.replace("Z", "+00:00")
        )

        if created_datetime.tzinfo is None:

            created_datetime = (
                created_datetime.replace(
                    tzinfo=timezone.utc
                )
            )

        target_date = (
            created_datetime
            + timedelta(days=horizon_days)
        ).isoformat()

    except (
        TypeError,
        ValueError,
        OverflowError,
    ) as exc:

        raise PredictionError(
            "Could not calculate the prediction target date."
        ) from exc

    confidence_score = _safe_float(
        prediction.get("confidence_score")
    )

    if confidence_score is not None:

        if not 0 <= confidence_score <= 100:

            raise PredictionError(
                "Confidence score must be between 0 and 100."
            )

    risk_details = prediction.get(
        "risk"
    )

    if not isinstance(risk_details, dict):
        risk_details = {}

    model_details = prediction.get(
        "model_details",
        {},
    )

    if not isinstance(model_details, dict):
        model_details = {}

    metadata = {
        "company_name": _safe_text(
            prediction.get("company_name"),
            symbol,
        ),

        "currency": _safe_text(
            prediction.get("currency"),
            "INR"
            if symbol.endswith((".NS", ".BO"))
            else "USD",
        ),

        "profile_category": _safe_text(
            prediction.get("profile_category"),
        ),

        "risk": risk_details,

        "history_rows": _safe_int(
            prediction.get("history_rows"),
        ),

        "last_historical_date": _safe_text(
            prediction.get("last_historical_date"),
        ),

        "horizon_label": _safe_text(
            prediction.get("horizon_label"),
        ),

        "disclaimer": _safe_text(
            prediction.get("disclaimer"),
        ),

        "model_details": model_details,
    }

    try:

        metadata_json = json.dumps(
            metadata,
            ensure_ascii=False,
            allow_nan=False,
        )

    except (
        TypeError,
        ValueError,
    ) as exc:

        raise PredictionError(
            "Could not safely serialize prediction metadata."
        ) from exc

    try:

        with get_db() as connection:

            cursor = connection.execute(
                """
                INSERT INTO predictions (
                    user_id,
                    symbol,
                    horizon_days,
                    reference_price,
                    predicted_price,
                    predicted_change,
                    predicted_change_percent,
                    model_name,
                    evaluation_rmse,
                    evaluation_mae,
                    risk_category,
                    explanation,
                    created_at,

                    status,
                    target_date,
                    confidence_score,
                    metadata_json
                )
                VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?
                )
                """,
                (
                    user_id,
                    symbol,
                    horizon_days,
                    reference_price,
                    predicted_price,
                    predicted_change,
                    predicted_change_percent,
                    model_name,
                    evaluation_rmse,
                    evaluation_mae,
                    risk_category,
                    explanation,
                    created_at,

                    "pending",
                    target_date,
                    confidence_score,
                    metadata_json,
                ),
            )

            prediction_id = cursor.lastrowid

        if prediction_id is None:

            raise PredictionError(
                "The database did not return a prediction ID."
            )

        logger.info(
            "Prediction saved: id=%s user=%s symbol=%s horizon=%s",
            prediction_id,
            user_id,
            symbol,
            horizon_days,
        )

        return int(
            prediction_id
        )

    except PredictionError:
        raise

    except Exception as exc:

        logger.exception(
            "Could not save prediction for user %s",
            user_id,
        )

        raise PredictionError(
            f"Could not save prediction to the database: {exc}"
        ) from exc


# =========================================================
# 14. GET PREDICTION HISTORY
# =========================================================

def get_prediction_history(
    user_id: str,
    limit: int = 50,
):
    """
    Retrieve a user's prediction history.

    Includes lifecycle, notification, completion
    and withdrawal information.
    """

    user_id = _safe_text(
        user_id
    )

    if not user_id:

        raise PredictionError(
            "A valid user ID is required."
        )

    limit = max(
        1,
        min(
            _safe_int(limit, 50),
            100,
        ),
    )

    try:

        with get_db() as connection:

            cursor = connection.execute(
                """
                SELECT
                    id,
                    user_id,
                    symbol,
                    horizon_days,
                    reference_price,
                    predicted_price,
                    predicted_change,
                    predicted_change_percent,
                    model_name,
                    evaluation_rmse,
                    evaluation_mae,
                    risk_category,
                    explanation,
                    created_at,

                    status,
                    target_date,
                    target_reached_at,
                    last_price_checked_at,
                    last_observed_price,

                    actual_withdrawal_price,
                    withdrawal_date,
                    actual_quantity,
                    actual_profit_loss,
                    actual_return_percent,

                    notification_sent_at,
                    notification_attempted_at,
                    notification_error,

                    confidence_score,
                    metadata_json,
                    cancelled_at

                FROM predictions

                WHERE user_id = ?

                ORDER BY created_at DESC, id DESC

                LIMIT ?
                """,
                (
                    user_id,
                    limit,
                ),
            )

            rows = cursor.fetchall()

        results = []

        for row in rows:

            item = dict(row)

            metadata_json = (
                item.get("metadata_json")
                or "{}"
            )

            try:

                metadata = json.loads(
                    metadata_json
                )

                if not isinstance(metadata, dict):
                    metadata = {}

            except (
                TypeError,
                ValueError,
            ):

                metadata = {}

            item["metadata"] = metadata

            item["status"] = _safe_text(
                item.get("status"),
                "pending",
            ).lower()

            results.append(
                item
            )

        return results

    except Exception as exc:

        logger.exception(
            "Could not retrieve prediction history for user %s",
            user_id,
        )

        raise PredictionError(
            f"Could not retrieve prediction history: {exc}"
        ) from exc