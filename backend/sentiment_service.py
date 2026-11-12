"""Local financial-news sentiment analysis for Market Plus AI.

Features:
- Positive, negative, and neutral sentiment classification.
- Weighted sentiment scoring.
- Aggregate sentiment summaries.
- Basic financial-language and negation handling.
- Duplicate-news filtering.
- Compatibility with news dictionaries returned by news_service.py.

This is a lightweight, rule-based analyzer. It does not use a paid
AI API and does not claim to understand every financial headline.
Its results are estimates, not investment recommendations.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from datetime import datetime
from typing import Any, Iterable, Optional


SERVICE_NAME = "Market Plus AI Local Sentiment Analyzer"
SERVICE_VERSION = "1.0.0"

POSITIVE_WORDS = {
    "beat", "beats", "beating", "bullish", "buy", "bought",
    "growth", "grow", "grows", "growing", "gain", "gains",
    "gained", "profit", "profits", "profitable", "surge",
    "surges", "surged", "rally", "rallies", "rallied",
    "rise", "rises", "rising", "rose", "higher", "high",
    "strong", "stronger", "strength", "positive", "upgrade",
    "upgraded", "outperform", "outperformed", "record",
    "records", "breakthrough", "innovation", "expansion",
    "expanded", "recovery", "recover", "recovered",
    "dividend", "dividends", "exceeds", "exceeded",
    "exceeding", "optimistic", "optimism", "robust",
    "resilient", "improved", "improves", "improvement",
    "successful", "success", "opportunity", "opportunities",
    "approval", "approved", "partnership", "contract",
    "contracts", "wins", "won", "award", "awarded",
    "cash-rich", "undervalued", "momentum",
}

NEGATIVE_WORDS = {
    "bearish", "sell", "sold", "loss", "losses", "lost",
    "decline", "declines", "declined", "fall", "falls",
    "falling", "fell", "drop", "drops", "dropped",
    "plunge", "plunges", "plunged", "crash", "crashes",
    "crashed", "weak", "weaker", "weakness", "negative",
    "downgrade", "downgraded", "underperform",
    "underperformed", "miss", "misses", "missed",
    "misses-estimates", "disappointing", "disappointment",
    "risk", "risks", "risky", "debt", "default", "defaults",
    "bankruptcy", "bankrupt", "fraud", "scandal", "lawsuit",
    "investigation", "probe", "penalty", "fined", "fine",
    "warning", "warns", "warned", "uncertainty", "uncertain",
    "volatile", "volatility", "recession", "inflation",
    "slowdown", "layoffs", "layoff", "cuts", "cut",
    "loss-making", "overvalued", "concern", "concerns",
    "concerned", "crisis", "sanctions", "conflict", "war",
    "attack", "attacks", "disruption", "disrupted",
    "recall", "recalled", "suspension", "suspended",
}

NEGATIONS = {
    "not", "no", "never", "neither", "nor", "without",
    "hardly", "isnt", "wasnt", "werent", "doesnt",
    "didnt", "dont", "cannot", "cant", "couldnt",
    "wont", "wouldnt", "fails", "failed", "failure",
}

INTENSIFIERS = {
    "very": 1.5,
    "strongly": 1.5,
    "sharply": 1.5,
    "significantly": 1.4,
    "substantially": 1.4,
    "slightly": 0.6,
    "marginally": 0.6,
    "somewhat": 0.8,
    "moderately": 0.9,
}

TOKEN_PATTERN = re.compile(
    r"[a-z]+(?:['-][a-z]+)*|\d+(?:\.\d+)?%?",
    flags=re.IGNORECASE,
)

# These expressions can help detect phrases that should not be interpreted
# as a directional market signal without more context.
NEUTRAL_PHRASES = (
    "to announce",
    "will announce",
    "scheduled to",
    "set to announce",
    "files for",
    "filed for",
    "board meeting",
    "annual general meeting",
    "quarterly results on",
    "results date",
    "shareholder meeting",
)


# ---------------------------------------------------------------------
# INPUT NORMALIZATION
# ---------------------------------------------------------------------

def _safe_text(value: Any) -> str:
    """Convert supported input values into safe plain text."""
    if value is None:
        return ""

    if isinstance(value, str):
        return value.strip()

    return ""


def _extract_text(item: Any) -> str:
    """Extract headline and description text from a news item."""
    if isinstance(item, str):
        return item.strip()

    if not isinstance(item, dict):
        return ""

    possible_fields = (
        "title",
        "headline",
        "summary",
        "description",
        "snippet",
        "content",
    )

    parts = []

    for field in possible_fields:
        value = _safe_text(item.get(field))

        if value and value not in parts:
            parts.append(value)

    return ". ".join(parts)


def _tokenize(text: str) -> list[str]:
    """Tokenize text while preserving simple contractions and hyphens."""
    return [token.lower() for token in TOKEN_PATTERN.findall(text)]


def _normalize_phrase(text: str) -> str:
    """Normalize text for duplicate detection."""
    return " ".join(_tokenize(text))


def _number(value: Any) -> Optional[float]:
    """Convert a numeric value to a finite float."""
    if isinstance(value, bool):
        return None

    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        return None

    return result if math.isfinite(result) else None


# ---------------------------------------------------------------------
# SENTIMENT CLASSIFICATION
# ---------------------------------------------------------------------

def analyze_sentiment(text: str) -> dict:
    """Analyze one headline or text description.

    Returns a dictionary containing:
        sentiment: positive, negative, or neutral
        score: normalized score from -1.0 to 1.0
        confidence: heuristic indicator from 0.0 to 1.0
        positive_count: positive lexical matches
        negative_count: negative lexical matches
        matched_positive: matched positive words
        matched_negative: matched negative words
        explanation: short explanation of the classification

    The confidence value is a heuristic based on lexical evidence. It is
    not a statistically calibrated probability.
    """
    if not isinstance(text, str):
        text = ""

    original_text = text.strip()
    tokens = _tokenize(original_text)

    if not tokens:
        return {
            "sentiment": "neutral",
            "score": 0.0,
            "confidence": 0.0,
            "positive_count": 0,
            "negative_count": 0,
            "matched_positive": [],
            "matched_negative": [],
            "explanation": "No analyzable text was provided.",
        }

    positive_matches: list[str] = []
    negative_matches: list[str] = []
    raw_score = 0.0

    for index, token in enumerate(tokens):
        if token not in POSITIVE_WORDS and token not in NEGATIVE_WORDS:
            continue

        polarity = 1 if token in POSITIVE_WORDS else -1
        strength = 1.0

        # Look for a nearby negation in the preceding three tokens.
        preceding = tokens[max(0, index - 3):index]

        if any(word in NEGATIONS for word in preceding):
            polarity *= -1
            strength *= 0.8

        # Apply a small adjustment when a sentiment word is intensified.
        if index > 0 and tokens[index - 1] in INTENSIFIERS:
            strength *= INTENSIFIERS[tokens[index - 1]]

        raw_score += polarity * strength

        if polarity > 0:
            positive_matches.append(token)
        else:
            negative_matches.append(token)

    # Normalize by the amount of text so a long headline is not
    # automatically scored more strongly than a short headline.
    token_count = max(len(tokens), 1)
    normalized = raw_score / math.sqrt(token_count)

    # The tanh transformation keeps the score in the [-1, 1] range.
    score = math.tanh(normalized / 2.0)
    score = round(score, 4)

    if score > 0.08:
        sentiment = "positive"
    elif score < -0.08:
        sentiment = "negative"
    else:
        sentiment = "neutral"

    evidence_count = len(positive_matches) + len(negative_matches)

    if evidence_count == 0:
        confidence = 0.25
        explanation = (
            "No strong sentiment keywords were detected. "
            "The text is classified as neutral by the rule-based analyzer."
        )
    else:
        confidence = min(
            0.90,
            0.35 + 0.12 * evidence_count + 0.15 * abs(score),
        )

        if sentiment == "positive":
            explanation = (
                "Positive financial-language indicators outweigh "
                "negative indicators in the supplied text."
            )
        elif sentiment == "negative":
            explanation = (
                "Negative financial-language indicators outweigh "
                "positive indicators in the supplied text."
            )
        else:
            explanation = (
                "The detected positive and negative indicators are "
                "balanced or too weak for a directional classification."
            )

    normalized_text = _normalize_phrase(original_text)

    if any(phrase in normalized_text for phrase in NEUTRAL_PHRASES):
        explanation += (
            " The text may describe a scheduled event rather than "
            "an actual financial outcome."
        )

    return {
        "sentiment": sentiment,
        "score": score,
        "confidence": round(confidence, 4),
        "positive_count": len(positive_matches),
        "negative_count": len(negative_matches),
        "matched_positive": sorted(set(positive_matches)),
        "matched_negative": sorted(set(negative_matches)),
        "explanation": explanation,
    }


# ---------------------------------------------------------------------
# NEWS ITEM ANALYSIS
# ---------------------------------------------------------------------

def analyze_news_item(item: Any) -> dict:
    """Analyze a news item while preserving its available metadata."""
    text = _extract_text(item)
    result = analyze_sentiment(text)

    if isinstance(item, dict):
        output = dict(item)
    else:
        output = {"title": _safe_text(item)}

    output["sentiment"] = result["sentiment"]
    output["sentiment_score"] = result["score"]
    output["sentiment_confidence"] = result["confidence"]
    output["sentiment_explanation"] = result["explanation"]
    output["sentiment_evidence"] = {
        "positive": result["matched_positive"],
        "negative": result["matched_negative"],
    }

    return output


def analyze_news_items(
    items: Iterable[Any],
    deduplicate: bool = True,
) -> list[dict]:
    """Analyze a collection of news items.

    Duplicate headlines are ignored when deduplicate=True.
    Input order is preserved.
    """
    if items is None:
        return []

    analyzed: list[dict] = []
    seen: set[str] = set()

    for item in items:
        text = _extract_text(item)

        if not text:
            continue

        normalized = _normalize_phrase(text)

        if deduplicate and normalized in seen:
            continue

        seen.add(normalized)
        analyzed.append(analyze_news_item(item))

    return analyzed


# ---------------------------------------------------------------------
# AGGREGATED SENTIMENT
# ---------------------------------------------------------------------

def summarize_sentiment(
    items: Iterable[Any],
    deduplicate: bool = True,
) -> dict:
    """Summarize sentiment across a collection of news items.

    Each distinct article receives equal weight. This prevents a single
    long article from dominating the summary merely because it contains
    more words.

    Returns:
        article_count
        positive_count
        negative_count
        neutral_count
        average_score
        overall_sentiment
        sentiment_distribution
        explanation
        analyzed_news
    """
    analyzed = analyze_news_items(items, deduplicate=deduplicate)

    if not analyzed:
        return {
            "article_count": 0,
            "positive_count": 0,
            "negative_count": 0,
            "neutral_count": 0,
            "average_score": 0.0,
            "overall_sentiment": "neutral",
            "sentiment_distribution": {
                "positive": 0.0,
                "negative": 0.0,
                "neutral": 0.0,
            },
            "explanation": "No usable news articles were available.",
            "analyzed_news": [],
        }

    counts = Counter(item["sentiment"] for item in analyzed)
    article_count = len(analyzed)

    scores = [
        _number(item.get("sentiment_score"))
        for item in analyzed
    ]
    valid_scores = [score for score in scores if score is not None]

    average_score = (
        sum(valid_scores) / len(valid_scores)
        if valid_scores
        else 0.0
    )
    average_score = round(average_score, 4)

    if average_score > 0.08:
        overall = "positive"
    elif average_score < -0.08:
        overall = "negative"
    else:
        overall = "neutral"

    distribution = {
        label: round(counts.get(label, 0) / article_count * 100, 2)
        for label in ("positive", "negative", "neutral")
    }

    if overall == "positive":
        explanation = (
            "The analyzed headlines lean positive overall. "
            "This describes the language of the available news, "
            "not a guaranteed increase in market price."
        )
    elif overall == "negative":
        explanation = (
            "The analyzed headlines lean negative overall. "
            "This describes the language of the available news, "
            "not a guaranteed decrease in market price."
        )
    else:
        explanation = (
            "The available headlines show mixed, weak, or neutral "
            "sentiment overall."
        )

    return {
        "article_count": article_count,
        "positive_count": counts.get("positive", 0),
        "negative_count": counts.get("negative", 0),
        "neutral_count": counts.get("neutral", 0),
        "average_score": average_score,
        "overall_sentiment": overall,
        "sentiment_distribution": distribution,
        "explanation": explanation,
        "analyzed_news": analyzed,
    }


# ---------------------------------------------------------------------
# OPTIONAL TIME-WEIGHTED SENTIMENT
# ---------------------------------------------------------------------

def _parse_datetime(value: Any) -> Optional[datetime]:
    """Parse common ISO-8601 timestamp formats."""
    if isinstance(value, datetime):
        return value

    if not isinstance(value, str) or not value.strip():
        return None

    normalized = value.strip()

    try:
        return datetime.fromisoformat(
            normalized.replace("Z", "+00:00")
        )
    except ValueError:
        return None


def summarize_time_weighted_sentiment(
    items: Iterable[Any],
    half_life_hours: float = 24.0,
) -> dict:
    """Calculate an optional recency-weighted news sentiment score.

    Articles with parseable timestamps receive exponentially decaying
    weights. Articles without timestamps receive the average weight of
    dated articles, or weight 1.0 if no dates are available.

    This method measures recency-weighted headline language; it does
    not establish causality or predict returns.
    """
    half_life = _number(half_life_hours)

    if half_life is None or half_life <= 0:
        raise ValueError("half_life_hours must be a positive number.")

    analyzed = analyze_news_items(items)

    if not analyzed:
        return {
            "article_count": 0,
            "weighted_score": 0.0,
            "overall_sentiment": "neutral",
            "dated_article_count": 0,
            "explanation": "No usable news articles were available.",
        }

    now = datetime.now().astimezone()
    dated_items = []

    for item in analyzed:
        timestamp = None

        for field in (
            "published_at",
            "published",
            "publishedAt",
            "datetime",
            "date",
        ):
            timestamp = _parse_datetime(item.get(field))
            if timestamp is not None:
                break

        if timestamp is not None:
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=now.tzinfo)
            dated_items.append((item, timestamp))

    weights: list[float] = []

    for item in analyzed:
        timestamp = None

        for field in (
            "published_at",
            "published",
            "publishedAt",
            "datetime",
            "date",
        ):
            timestamp = _parse_datetime(item.get(field))
            if timestamp is not None:
                break

        if timestamp is None:
            weights.append(float("nan"))
            continue

        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=now.tzinfo)

        age_hours = max(
            0.0,
            (now - timestamp.astimezone(now.tzinfo)).total_seconds()
            / 3600.0,
        )

        weight = math.exp(
            -math.log(2.0) * age_hours / half_life
        )
        weights.append(weight)

    known_weights = [
        weight for weight in weights if math.isfinite(weight)
    ]

    fallback_weight = (
        sum(known_weights) / len(known_weights)
        if known_weights
        else 1.0
    )

    final_weights = [
        weight if math.isfinite(weight) else fallback_weight
        for weight in weights
    ]

    weighted_total = sum(final_weights)

    if weighted_total <= 0:
        weighted_score = 0.0
    else:
        weighted_score = sum(
            float(item["sentiment_score"]) * weight
            for item, weight in zip(analyzed, final_weights)
        ) / weighted_total

    weighted_score = round(weighted_score, 4)

    if weighted_score > 0.08:
        overall = "positive"
    elif weighted_score < -0.08:
        overall = "negative"
    else:
        overall = "neutral"

    return {
        "article_count": len(analyzed),
        "weighted_score": weighted_score,
        "overall_sentiment": overall,
        "dated_article_count": len(dated_items),
        "half_life_hours": half_life,
        "explanation": (
            "Recent articles receive more weight than older articles. "
            "This score reflects headline sentiment, not a prediction "
            "of future asset prices."
        ),
    }
