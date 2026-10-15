//! Nockchain helpers for Akoya (see Cargo.toml). Read-only: nothing here signs or spends.

use iris_crypto::{derive_master_key, PublicKey};
use iris_nockchain_types::tx_engine::v1::{LockPrimitive, LockTim, Pkh, SpendCondition};
use iris_ztd::{Digest, Hashable};
use wasm_bindgen::prelude::*;

/// BIP39 seed (64 bytes, passphrase "") → master public key (97 bytes), exactly as
/// `nockchain-wallet import-keys --seedphrase … --version 1` derives it. The private key exists
/// only inside this call and is dropped before it returns.
pub fn master_public_key(seed: &[u8]) -> Result<[u8; 97], &'static str> {
    if seed.len() != 64 {
        return Err("seed must be 64 bytes");
    }
    Ok(derive_master_key(seed).public_key.to_be_bytes())
}

/// Public key (97 bytes) → v1 address: the base58 Tip5 hash of the key ("PKH").
pub fn address_of(public_key: &[u8]) -> Result<String, &'static str> {
    let bytes: &[u8; 97] = public_key.try_into().map_err(|_| "public key must be 97 bytes")?;
    Ok(PublicKey::from_be_bytes(bytes).hash().to_string())
}

/// Address → the note first-names a node indexes balances by: [plain payments, mining rewards].
/// Mining rewards (coinbase) carry the standard coinbase timelock in their lock.
pub fn first_names(address: &str) -> Result<[String; 2], &'static str> {
    // v1 addresses are the base58 form of a 40-byte digest: ~50–55 characters
    if !(40..=60).contains(&address.len()) {
        return Err("invalid address");
    }
    let digest = Digest::try_from(address).map_err(|_| "invalid address")?;
    // canonical encoding only, so one address can't map to two different lookups
    if digest.to_string() != address {
        return Err("invalid address");
    }
    let pkh = Pkh::single(digest);
    let simple = SpendCondition::new_pkh(pkh.clone()).first_name();
    let coinbase = SpendCondition([LockPrimitive::Pkh(pkh), LockPrimitive::Tim(LockTim::coinbase())].into()).first_name();
    Ok([simple.to_string(), coinbase.to_string()])
}

// ---- JS bindings (thin wrappers; errors become exceptions)

#[wasm_bindgen(js_name = masterPublicKey)]
pub fn js_master_public_key(seed: &[u8]) -> Result<Vec<u8>, JsError> {
    master_public_key(seed).map(|k| k.to_vec()).map_err(JsError::new)
}

#[wasm_bindgen(js_name = addressOf)]
pub fn js_address_of(public_key: &[u8]) -> Result<String, JsError> {
    address_of(public_key).map_err(JsError::new)
}

#[wasm_bindgen(js_name = firstNames)]
pub fn js_first_names(address: &str) -> Result<Vec<String>, JsError> {
    first_names(address).map(Vec::from).map_err(JsError::new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use iris_crypto::Mnemonic;

    const ABANDON: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    fn seed(phrase: &str) -> [u8; 64] {
        Mnemonic::parse(phrase).unwrap().to_seed("")
    }

    #[test]
    fn matches_official_wallet() {
        // `nockchain-wallet --new --data-dir <tmp> import-keys --seedphrase "abandon … about" --version 1`
        // printed: Master Key (Imported) - Address: 3zxKWhhd8HY9pT2ZCZNUSEz2XWwSk15P2sD3atnnnxRtHa2Ta1H4jRy
        let pk = master_public_key(&seed(ABANDON)).unwrap();
        assert_eq!(address_of(&pk).unwrap(), "3zxKWhhd8HY9pT2ZCZNUSEz2XWwSk15P2sD3atnnnxRtHa2Ta1H4jRy");
        // 24 words — the phrase from iris-rs' own nockchain-wallet keygen vector
        let clutch = "clutch inmate mango seek attract credit illegal popular term loyal fiber output trumpet lucky garbage merge menu certain dynamic aim trip fantasy master unveil";
        let pk = master_public_key(&seed(clutch)).unwrap();
        assert_eq!(address_of(&pk).unwrap(), "3b3eG8WgWHfXTeAMJzNDWxM3b6WFadxQiiJRQrY6zPJ4J2F5QtHjZRQ");
    }

    #[test]
    fn first_names_are_stable_and_distinct() {
        let [simple, coinbase] = first_names("3zxKWhhd8HY9pT2ZCZNUSEz2XWwSk15P2sD3atnnnxRtHa2Ta1H4jRy").unwrap();
        assert_ne!(simple, coinbase);
        assert!(Digest::try_from(simple.as_str()).is_ok() && Digest::try_from(coinbase.as_str()).is_ok());
    }

    #[test]
    fn rejects_bad_input() {
        assert!(master_public_key(&[0u8; 32]).is_err());
        assert!(address_of(&[0u8; 96]).is_err());
        assert!(first_names("not-an-address").is_err());
        assert!(first_names("").is_err());
    }
}
