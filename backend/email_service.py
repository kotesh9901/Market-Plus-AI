
"""Email delivery service for Market Plus AI.

Uses SMTP to send application emails.
Supports Gmail App Password authentication and other SMTP providers.

Credentials must be stored in environment variables, never in source code.
"""

import logging
import os
import re
import smtplib
import ssl

from email.message import EmailMessage
from email.utils import formataddr

logger = logging.getLogger(__name__)


def _get_config():
    """Read SMTP configuration from environment variables."""
    host = os.getenv("SMTP_HOST", "").strip()
    username = os.getenv("SMTP_USERNAME", "").strip()
    password = os.getenv("SMTP_PASSWORD", "").strip()
    from_email = os.getenv("SMTP_FROM_EMAIL", "").strip()

    try:
        port = int(os.getenv("SMTP_PORT", "587"))
    except (TypeError, ValueError):
        port = 587

    use_tls = (
        os.getenv("SMTP_USE_TLS", "true").strip().lower()
        in {"1", "true", "yes", "on"}
    )

    use_ssl = (
        os.getenv("SMTP_USE_SSL", "false").strip().lower()
        in {"1", "true", "yes", "on"}
    )

    from_name = os.getenv(
        "SMTP_FROM_NAME",
        "Market Plus AI",
    ).strip()

    timeout = 20

    return {
        "host": host,
        "port": port,
        "username": username,
        "password": password,
        "from_email": from_email,
        "from_name": from_name,
        "use_tls": use_tls,
        "use_ssl": use_ssl,
        "timeout": timeout,
    }


def _valid_email(address):
    """Perform basic email-address validation."""
    if not isinstance(address, str):
        return False

    address = address.strip()

    if len(address) > 254:
        return False

    return bool(
        re.fullmatch(
            r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+"
            r"@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?"
            r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+",
            address,
        )
    )


def get_email_service_status():
    """Return configuration readiness without exposing credentials."""
    config = _get_config()

    configured = all(
        [
            config["host"],
            config["username"],
            config["password"],
            config["from_email"],
        ]
    )

    if config["use_tls"] and config["use_ssl"]:
        configured = False

    if config["port"] < 1 or config["port"] > 65535:
        configured = False

    if not _valid_email(config["from_email"]):
        configured = False

    return {
        "configured": configured,
        "provider": "SMTP",
        "host_configured": bool(config["host"]),
        "username_configured": bool(config["username"]),
        "password_configured": bool(config["password"]),
        "sender_configured": bool(config["from_email"]),
        "tls_enabled": config["use_tls"],
        "ssl_enabled": config["use_ssl"],
    }


def send_email(
    to_email,
    subject,
    body,
    html_body=None,
):
    """Send an email and return a structured delivery result.

    Returns:
        {
            "success": bool,
            "status": "sent" | "failed" | "not_configured",
            "message": str,
            "error": str
        }
    """

    if not _valid_email(to_email):
        return {
            "success": False,
            "status": "failed",
            "message": "The recipient email address is invalid.",
            "error": "invalid_recipient",
        }

    if not isinstance(subject, str) or not subject.strip():
        return {
            "success": False,
            "status": "failed",
            "message": "Email subject is required.",
            "error": "missing_subject",
        }

    if not isinstance(body, str) or not body.strip():
        return {
            "success": False,
            "status": "failed",
            "message": "Email message body is required.",
            "error": "missing_body",
        }

    config = _get_config()

    status = get_email_service_status()

    if not status["configured"]:
        return {
            "success": False,
            "status": "not_configured",
            "message": "Email service is not configured.",
            "error": "smtp_not_configured",
        }

    try:
        message = EmailMessage()

        message["Subject"] = subject.strip()
        message["From"] = formataddr(
            (
                config["from_name"],
                config["from_email"],
            )
        )
        message["To"] = to_email.strip()

        message.set_content(body.strip())

        if html_body is not None:
            if not isinstance(html_body, str) or not html_body.strip():
                raise ValueError("HTML email body must be a non-empty string.")

            message.add_alternative(
                html_body,
                subtype="html",
            )

        context = ssl.create_default_context()

        if config["use_ssl"]:
            with smtplib.SMTP_SSL(
                config["host"],
                config["port"],
                timeout=config["timeout"],
                context=context,
            ) as server:
                server.login(
                    config["username"],
                    config["password"],
                )

                refused = server.send_message(message)

        else:
            with smtplib.SMTP(
                config["host"],
                config["port"],
                timeout=config["timeout"],
            ) as server:

                server.ehlo()

                if config["use_tls"]:
                    server.starttls(context=context)
                    server.ehlo()

                server.login(
                    config["username"],
                    config["password"],
                )

                refused = server.send_message(message)

        if refused:
            logger.warning(
                "SMTP server refused the email recipient."
            )

            return {
                "success": False,
                "status": "failed",
                "message": "SMTP server did not accept the recipient.",
                "error": "recipient_refused",
            }

        logger.info(
            "Email accepted by SMTP server for recipient."
        )

        return {
            "success": True,
            "status": "sent",
            "message": "Email accepted by the SMTP server.",
            "error": "",
        }

    except smtplib.SMTPAuthenticationError:
        logger.exception("SMTP authentication failed.")

        return {
            "success": False,
            "status": "failed",
            "message": "SMTP authentication failed. Check your credentials.",
            "error": "smtp_authentication_failed",
        }

    except smtplib.SMTPRecipientsRefused:
        logger.exception("SMTP rejected the recipient.")

        return {
            "success": False,
            "status": "failed",
            "message": "SMTP rejected the recipient address.",
            "error": "smtp_recipient_rejected",
        }

    except (smtplib.SMTPException, OSError, ssl.SSLError):
        logger.exception("Email delivery failed.")

        return {
            "success": False,
            "status": "failed",
            "message": "Email delivery failed. Check SMTP settings and connectivity.",
            "error": "smtp_delivery_failed",
        }

    except ValueError:
        logger.exception("Invalid email configuration or content.")

        return {
            "success": False,
            "status": "failed",
            "message": "Email configuration or message content is invalid.",
            "error": "invalid_email_configuration",
        }
