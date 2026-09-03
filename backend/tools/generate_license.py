#!/usr/bin/env python3
"""
generate_license.py -- generates Duplicate Finder license keys.

IMPORTANT: the salt below must always match kLicenseSalt in
backend/src/license.hpp exactly, or generated keys won't verify. If you
ever change one, change the other too.

Usage:
    python generate_license.py            # generate 1 key
    python generate_license.py 5          # generate 5 keys

This is meant for manual sales (e.g. via Gumroad/itch.io) before you've
wired up automatic key delivery. Keep a record of which key went to which
sale -- there's no server-side tracking yet, so a leaked key can't be
revoked, only replaced by asking the buyer to activate a fresh one.
"""

import hashlib
import secrets
import sys

# Must match kLicenseSalt in backend/src/license.hpp
LICENSE_SALT = "dupfinder-b7f2-license-salt-v1"

SERIAL_LEN = 16   # hex chars
CHECKSUM_LEN = 8  # hex chars


def generate_key() -> str:
    serial = secrets.token_hex(SERIAL_LEN // 2).upper()  # 16 hex chars
    checksum = hashlib.sha256((LICENSE_SALT + serial).encode()).hexdigest()[:CHECKSUM_LEN].upper()
    raw = serial + checksum
    # Group into 4-char chunks for readability, matching what the app expects.
    grouped = "-".join(raw[i:i + 4] for i in range(0, len(raw), 4))
    return grouped


def verify_key(key: str) -> bool:
    """Sanity check -- mirrors license_key_is_valid() in license.hpp."""
    cleaned = key.replace("-", "").replace(" ", "").upper()
    if len(cleaned) != SERIAL_LEN + CHECKSUM_LEN:
        return False
    serial, checksum = cleaned[:SERIAL_LEN], cleaned[SERIAL_LEN:]
    expected = hashlib.sha256((LICENSE_SALT + serial).encode()).hexdigest()[:CHECKSUM_LEN].upper()
    return checksum == expected


if __name__ == "__main__":
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    for _ in range(count):
        key = generate_key()
        assert verify_key(key), "generated key failed self-check -- bug!"
        print(key)
