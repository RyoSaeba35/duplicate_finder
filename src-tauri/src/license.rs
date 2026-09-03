// license.rs — license activation against Gumroad's license-key API,
// with a local tamper-resistant cache so normal launches never touch the
// network.
//
// Two different problems, two different mechanisms:
//   1. Key-sharing (one key activated on many strangers' machines): solved
//      by calling Gumroad's licenses/verify endpoint ONCE, at activation
//      time, with increment_uses_count=true. Gumroad tracks the total use
//      count server-side across every device that's ever activated that
//      exact key -- we refuse activation past a threshold we choose here
//      (Gumroad doesn't enforce a limit itself, it just reports the
//      count). This is real enforcement; the old offline-only checksum
//      scheme had none.
//   2. Casual local tampering (hand-editing the cache file to grant a
//      free license without ever having a real key): solved the same way
//      as before -- a locally salted checksum over the verified key. This
//      does NOT require network access, so a normal app launch never
//      calls Gumroad at all; only the activation button does.
//
// Trade-off worth knowing: because launches don't re-verify online, a
// refund/chargeback after activation won't revoke access on this device
// until the next re-activation. Adding a periodic (e.g. monthly)
// background re-check -- done without blocking startup -- would close
// that gap; not implemented yet, flagged here as a natural next step.

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

use crate::trial::app_data_dir;

// Replace with the product ID shown in your Gumroad product's settings
// once "Generate a unique license key per sale" is enabled. This is NOT
// a secret -- it just identifies which product a key belongs to.
const GUMROAD_PRODUCT_ID: &str = "D6LM3QuXG6SUtzmrZkG3jA==";

// How many devices a single key may activate before we refuse further
// activations. Gumroad just reports the running count; this cutoff is
// entirely our own decision. 3 is a reasonable default for one person
// with a work PC, a home PC, and a laptop.
const MAX_ACTIVATIONS: u64 = 3;

// Purely local -- protects the CACHE FILE from casual hand-editing, not
// from network-level attacks. A different secret than trial.rs's salt;
// these protect different things.
const CACHE_SALT: &str = "dupfinder-c4a1-license-cache-salt-v1";

fn license_state_path() -> PathBuf {
    app_data_dir().join(".dflicense")
}

fn cache_checksum_for(key: &str) -> String {
    let input = format!("{CACHE_SALT}{key}");
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[derive(Deserialize)]
struct GumroadPurchase {
    #[serde(default)]
    refunded: bool,
    #[serde(default)]
    chargebacked: bool,
    #[serde(default)]
    disputed: bool,
}

#[derive(Deserialize)]
struct GumroadVerifyResponse {
    success: bool,
    #[serde(default)]
    uses: u64,
    #[serde(default)]
    message: Option<String>,
    purchase: Option<GumroadPurchase>,
}

pub enum ActivateOutcome {
    Activated,
    Rejected(String),
}

/// Calls Gumroad's licenses/verify endpoint once, with
/// increment_uses_count=true. This is the ONE place in the whole app that
/// makes a network call -- deliberately confined to the moment the user
/// clicks "Activate", never on ordinary launch.
pub fn activate(raw_key: &str) -> ActivateOutcome {
    let key = raw_key.trim();
    if key.is_empty() {
        return ActivateOutcome::Rejected("license key is empty".to_string());
    }

    let result = ureq::post("https://api.gumroad.com/v2/licenses/verify").send_form(&[
        ("product_id", GUMROAD_PRODUCT_ID),
        ("license_key", key),
        ("increment_uses_count", "true"),
    ]);

    // A 404 from Gumroad (key doesn't exist) still carries a JSON body
    // with a message -- ureq treats non-2xx as an Err, so both branches
    // need to reach the same "try to read a body" path.
    let response = match result {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) => r,
        Err(e) => {
            return ActivateOutcome::Rejected(format!(
                "could not reach Gumroad -- check your internet connection ({e})"
            ));
        }
    };

    let data: GumroadVerifyResponse = match response.into_json() {
        Ok(d) => d,
        Err(e) => {
            return ActivateOutcome::Rejected(format!("unexpected response from Gumroad ({e})"));
        }
    };

    if !data.success {
        return ActivateOutcome::Rejected(
            data.message.unwrap_or_else(|| "invalid license key".to_string()),
        );
    }

    if let Some(p) = &data.purchase {
        if p.refunded || p.chargebacked || p.disputed {
            return ActivateOutcome::Rejected(
                "this purchase was refunded, disputed, or charged back".to_string(),
            );
        }
    }

    if data.uses > MAX_ACTIVATIONS {
        return ActivateOutcome::Rejected(format!(
            "this key has already been activated on {} devices, which is over the limit -- contact support if this is your own hardware",
            data.uses
        ));
    }

    // Passed every check -- cache it locally so future launches don't
    // need the network at all.
    let dir = app_data_dir();
    if fs::create_dir_all(&dir).is_err() {
        return ActivateOutcome::Rejected("could not save license locally".to_string());
    }
    let checksum = cache_checksum_for(key);
    match fs::write(license_state_path(), format!("{key} {checksum}")) {
        Ok(()) => ActivateOutcome::Activated,
        Err(_) => ActivateOutcome::Rejected("could not save license locally".to_string()),
    }
}

/// Fast, fully offline check -- this is what runs on every ordinary
/// launch via trial_status. Never touches the network. Re-verifies the
/// local checksum rather than trusting the file's mere existence, so a
/// hand-written fake cache file doesn't grant a license.
pub fn has_valid_saved_license() -> bool {
    let contents = match fs::read_to_string(license_state_path()) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let mut parts = contents.split_whitespace();
    let (key, stored_checksum) = match (parts.next(), parts.next()) {
        (Some(k), Some(c)) => (k, c),
        _ => return false,
    };
    cache_checksum_for(key).eq_ignore_ascii_case(stored_checksum)
}
