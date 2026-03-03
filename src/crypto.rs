use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::Zeroize;

pub struct KeyEncryptor {
    master_key: Vec<u8>,
}

impl KeyEncryptor {
    pub fn new(master_key: Vec<u8>) -> Result<Self, String> {
        if master_key.len() != 32 {
            return Err(format!(
                "Master key must be 32 bytes, got {}",
                master_key.len()
            ));
        }
        Ok(Self { master_key })
    }

    fn derive_key(&self, user_id: &str) -> Key<Aes256Gcm> {
        let hk = Hkdf::<Sha256>::new(Some(user_id.as_bytes()), &self.master_key);
        let mut okm = [0u8; 32];
        hk.expand(b"nostr-key-encryption", &mut okm)
            .expect("32 bytes is a valid length for HKDF-SHA256 expansion");
        let key = *Key::<Aes256Gcm>::from_slice(&okm);
        okm.zeroize();
        key
    }

    pub fn encrypt_nsec(
        &self,
        user_id: &str,
        secret_key_bytes: &[u8],
    ) -> Result<(Vec<u8>, Vec<u8>), String> {
        let key = self.derive_key(user_id);
        let cipher = Aes256Gcm::new(&key);
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher
            .encrypt(&nonce, secret_key_bytes)
            .map_err(|e| format!("Encryption failed: {e}"))?;
        Ok((ciphertext, nonce.to_vec()))
    }

    pub fn decrypt_nsec(
        &self,
        user_id: &str,
        ciphertext: &[u8],
        nonce_bytes: &[u8],
    ) -> Result<Vec<u8>, String> {
        let key = self.derive_key(user_id);
        let cipher = Aes256Gcm::new(&key);
        let nonce = Nonce::from_slice(nonce_bytes);
        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| format!("Decryption failed: {e}"))
    }
}

impl Drop for KeyEncryptor {
    fn drop(&mut self) {
        self.master_key.zeroize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip_encrypt_decrypt() {
        let master_key = vec![0xABu8; 32];
        let encryptor = KeyEncryptor::new(master_key).unwrap();
        let user_id = "user-123";
        let secret = b"my-secret-nostr-key-bytes-here!!";

        let (ciphertext, nonce) = encryptor.encrypt_nsec(user_id, secret).unwrap();
        let plaintext = encryptor.decrypt_nsec(user_id, &ciphertext, &nonce).unwrap();

        assert_eq!(plaintext, secret);
    }

    #[test]
    fn test_different_users_produce_different_ciphertext() {
        let master_key = vec![0xCDu8; 32];
        let encryptor = KeyEncryptor::new(master_key).unwrap();
        let secret = b"same-secret-for-both";

        let (ct1, _) = encryptor.encrypt_nsec("alice", secret).unwrap();
        let (ct2, _) = encryptor.encrypt_nsec("bob", secret).unwrap();

        // Ciphertexts should differ due to different derived keys and random nonces
        assert_ne!(ct1, ct2);
    }

    #[test]
    fn test_wrong_user_cannot_decrypt() {
        let master_key = vec![0xEFu8; 32];
        let encryptor = KeyEncryptor::new(master_key).unwrap();
        let secret = b"secret-data";

        let (ciphertext, nonce) = encryptor.encrypt_nsec("alice", secret).unwrap();
        let result = encryptor.decrypt_nsec("bob", &ciphertext, &nonce);

        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_master_key_length() {
        let short_key = vec![0u8; 16];
        assert!(KeyEncryptor::new(short_key).is_err());

        let long_key = vec![0u8; 64];
        assert!(KeyEncryptor::new(long_key).is_err());
    }
}
