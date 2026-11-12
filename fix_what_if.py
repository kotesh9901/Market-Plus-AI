
from pathlib import Path

PROJECT = Path(__file__).resolve().parent
JS_FILE = PROJECT / "static" / "js" / "what_if_market.js"
BACKUP_FILE = PROJECT / "static" / "js" / "what_if_market_backup.js"

def main():
    if not JS_FILE.exists():
        raise FileNotFoundError(
            f"JavaScript file not found: {JS_FILE}"
        )

    original = JS_FILE.read_text(
        encoding="utf-8-sig"
    )

    lines = original.splitlines(keepends=True)

    # Verify that this is the exact uploaded file structure.
    if len(lines) < 1413:
        raise RuntimeError(
            "Unexpected file length. Original file was not changed."
        )

    if lines[618].strip() != "(() => {":
        raise RuntimeError(
            "Expected JavaScript script start was not found "
            "at line 619. Original file was not changed."
        )

    # Keep the complete second script.
    # Remove the duplicated broken fragment.
    fixed_lines = lines[618:]
    del fixed_lines[794:819]

    corrected = "".join(fixed_lines)

    # Verify the corrected file boundaries.
    if not corrected.lstrip().startswith("(() => {"):
        raise RuntimeError("Invalid JavaScript beginning.")

    if not corrected.rstrip().endswith("})();"):
        raise RuntimeError("Invalid JavaScript ending.")

    # Preserve the original file as a backup.
    BACKUP_FILE.write_text(
        original,
        encoding="utf-8"
    )

    # Replace the original with the corrected complete file.
    JS_FILE.write_text(
        corrected,
        encoding="utf-8"
    )

    print("SUCCESS: Complete JavaScript file corrected.")
    print(f"Updated file: {JS_FILE}")
    print(f"Backup file:  {BACKUP_FILE}")
    print(f"Total lines:  {len(fixed_lines)}")

if __name__ == "__main__":
    main()
