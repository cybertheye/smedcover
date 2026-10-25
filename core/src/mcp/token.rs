//! The bearer token an agent shows to use the endpoint: `smc_` and 32 random bytes in base64url
//! (43 characters, no padding). It is kept as a [`Secret`], which does not print itself and is
//! compared in constant time.

use std::fmt;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

use crate::{err, Res};

/// What every token starts with, so one pasted in the wrong place can be recognised.
pub const PREFIX: &str = "smc_";
const RANDOM_BYTES: usize = 32;
/// The length of the base64url text of [`RANDOM_BYTES`] bytes, without padding.
const ENCODED_LEN: usize = 43;

/// A token. Its `Debug` shows `Secret(***)`, it has no `Display`, and [`Secret::matches`] takes as
/// long whatever it is given; the text is only to be had from [`Secret::expose`], for the one place
/// that shows it to the user (and the file that keeps it).
#[derive(Clone)]
pub struct Secret {
    text: String,
    digest: [u8; 32],
}

impl Secret {
    /// A new token from the system's random source.
    pub fn generate() -> Res<Secret> {
        let mut bytes = [0u8; RANDOM_BYTES];
        getrandom::fill(&mut bytes).map_err(err)?;
        let secret = Secret::new(format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(bytes)));
        bytes.fill(0);
        std::hint::black_box(&bytes);
        Ok(secret)
    }

    /// A token as it was saved, if it has a token's form.
    pub fn parse(text: &str) -> Option<Secret> {
        let body = text.strip_prefix(PREFIX)?;
        let decodes = body.len() == ENCODED_LEN
            && URL_SAFE_NO_PAD.decode(body).is_ok_and(|bytes| bytes.len() == RANDOM_BYTES);
        decodes.then(|| Secret::new(text.to_string()))
    }

    fn new(text: String) -> Secret {
        let digest = Sha256::digest(text.as_bytes()).into();
        Secret { text, digest }
    }

    /// The token's text. Only for showing it to the user and for saving it.
    pub fn expose(&self) -> &str {
        &self.text
    }

    /// Whether `given` is this token. Both are hashed first, so the comparison is of two 32-byte
    /// digests whatever their lengths, and it looks at every byte.
    pub fn matches(&self, given: &str) -> bool {
        let given: [u8; 32] = Sha256::digest(given.as_bytes()).into();
        let mut diff = 0u8;
        for (a, b) in self.digest.iter().zip(given.iter()) {
            diff |= std::hint::black_box(a ^ b);
        }
        std::hint::black_box(diff) == 0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(***)")
    }
}

impl Drop for Secret {
    fn drop(&mut self) {
        let mut bytes = std::mem::take(&mut self.text).into_bytes();
        bytes.fill(0);
        std::hint::black_box(&bytes);
    }
}

/// The token of an `Authorization` header's value, `Bearer <token>` (the scheme in any case).
pub fn bearer(authorization: &str) -> Option<&str> {
    let (scheme, token) = authorization.trim().split_once(' ')?;
    scheme.eq_ignore_ascii_case("bearer").then(|| token.trim()).filter(|t| !t.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_tokens_have_the_form_and_differ() {
        let a = Secret::generate().unwrap();
        let b = Secret::generate().unwrap();
        assert!(a.expose().starts_with(PREFIX));
        assert_eq!(a.expose().len(), PREFIX.len() + ENCODED_LEN);
        assert!(a.expose()[PREFIX.len()..].bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'));
        assert!(!a.matches(b.expose()), "two tokens should not be the same");
        assert!(Secret::parse(a.expose()).is_some_and(|p| p.matches(a.expose())));
    }

    #[test]
    fn matches_only_itself() {
        let s = Secret::generate().unwrap();
        let text = s.expose().to_string();
        assert!(s.matches(&text));
        assert!(!s.matches(""));
        assert!(!s.matches(&text[..text.len() - 1]));
        assert!(!s.matches(&format!("{text}x")));
        let mut flipped = text.clone().into_bytes();
        let last = flipped.len() - 1;
        flipped[last] = if flipped[last] == b'A' { b'B' } else { b'A' };
        assert!(!s.matches(std::str::from_utf8(&flipped).unwrap()));
    }

    #[test]
    fn parse_refuses_what_is_not_a_token() {
        let good = Secret::generate().unwrap().expose().to_string();
        for bad in ["", "smc_", "smc_short", &good[PREFIX.len()..], &format!("xyz_{}", &good[PREFIX.len()..]), &format!("{good}A"), &format!("smc_{}", "!".repeat(43))] {
            assert!(Secret::parse(bad).is_none(), "{bad:?} is not a token");
        }
    }

    #[test]
    fn debug_hides_it() {
        let s = Secret::generate().unwrap();
        let shown = format!("{s:?} {:?}", Some(s.clone()));
        assert!(!shown.contains(&s.expose()[PREFIX.len()..]));
        assert_eq!(format!("{s:?}"), "Secret(***)");
    }

    #[test]
    fn bearer_reads_the_header() {
        assert_eq!(bearer("Bearer smc_abc"), Some("smc_abc"));
        assert_eq!(bearer("bearer  smc_abc "), Some("smc_abc"));
        assert_eq!(bearer("BEARER smc_abc"), Some("smc_abc"));
        assert_eq!(bearer("Basic dXNlcjpwYXNz"), None);
        assert_eq!(bearer("Bearer"), None);
        assert_eq!(bearer("Bearer "), None);
        assert_eq!(bearer("smc_abc"), None);
    }
}
