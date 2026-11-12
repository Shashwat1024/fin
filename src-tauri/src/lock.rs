//! This computer's data key and Windows Hello (Fin 2.7). The key that encrypts `fin.db` is kept in
//! `fin.key` in the data folder, protected by Windows for the signed-in account (DPAPI), so only
//! this account on this computer can use it and Fin opens without a password. It is made the first
//! time encryption is turned on and kept, so backups encrypted with it stay readable.

use std::path::{Path, PathBuf};

use fin_core::db::key::DbKey;
use fin_core::log;
use tauri::{AppHandle, Manager};

use crate::background::throwaway_data;

fn key_file(data_dir: &Path) -> PathBuf {
    data_dir.join("fin.key")
}

/// Test seam: with a throwaway data folder (`FIN_DATA_DIR`), `FIN_E2E_KEY` (64 hex digits) is the
/// key instead of a protected `fin.key`.
fn test_key() -> Option<DbKey> {
    if !throwaway_data() {
        return None;
    }
    DbKey::from_hex(&std::env::var("FIN_E2E_KEY").ok()?)
}

/// The key this computer keeps for the data folder, if one was made.
pub fn load_key(data_dir: &Path) -> Option<DbKey> {
    if let Some(k) = test_key() {
        return Some(k);
    }
    let sealed = std::fs::read(key_file(data_dir)).ok()?;
    match unprotect(&sealed).and_then(|b| DbKey::from_bytes(&b)) {
        Some(k) => Some(k),
        None => {
            // Copied from another account or computer: Windows will not open it.
            log::warn("key.unreadable", &[]);
            None
        }
    }
}

/// Make and keep a new key (when encryption is first turned on).
pub fn create_key(data_dir: &Path) -> Option<DbKey> {
    if let Some(k) = test_key() {
        return Some(k);
    }
    let key = DbKey::generate();
    let sealed = protect(key.as_bytes())?;
    let file = key_file(data_dir);
    let tmp = data_dir.join("fin.key.tmp");
    std::fs::write(&tmp, sealed).ok()?;
    std::fs::rename(&tmp, &file).ok()?;
    log::info("key.created", &[]);
    Some(key)
}

#[cfg(windows)]
fn dpapi(data: &[u8], seal: bool) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
    };
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: plain Win32 calls with valid buffers; Windows allocates the output, freed below.
    unsafe {
        let done = if seal {
            CryptProtectData(
                &input,
                windows::core::w!("Fin data key"),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output)
        };
        done.ok()?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Some(bytes)
    }
}

#[cfg(windows)]
fn protect(data: &[u8]) -> Option<Vec<u8>> {
    dpapi(data, true)
}
#[cfg(windows)]
fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
    dpapi(data, false)
}
#[cfg(not(windows))]
fn protect(_: &[u8]) -> Option<Vec<u8>> {
    None
}
#[cfg(not(windows))]
fn unprotect(_: &[u8]) -> Option<Vec<u8>> {
    None
}

/// Test seam for Windows Hello: with a throwaway data folder, `FIN_E2E_HELLO` = `ok` (available and
/// confirms), `cancel` (available, the person cancels) or anything else (not set up). Without it,
/// tests never show a real Windows prompt: Hello counts as not set up.
fn hello_seam() -> Option<String> {
    throwaway_data().then(|| std::env::var("FIN_E2E_HELLO").unwrap_or_default())
}

/// Whether this computer has Windows Hello (face, fingerprint or Windows PIN) for this account.
pub fn hello_available() -> bool {
    if let Some(seam) = hello_seam() {
        return seam == "ok" || seam == "cancel";
    }
    // Asked each time: someone who forgot the PIN may set up Windows Hello while Fin is open.
    check_hello()
}

#[cfg(windows)]
fn check_hello() -> bool {
    use windows::Security::Credentials::UI::{UserConsentVerifier, UserConsentVerifierAvailability};
    UserConsentVerifier::CheckAvailabilityAsync()
        .and_then(|op| op.join())
        .is_ok_and(|a| a == UserConsentVerifierAvailability::Available)
}
#[cfg(not(windows))]
fn check_hello() -> bool {
    false
}

/// Ask Windows to confirm it is the signed-in person, over Fin's window. Blocks until answered.
pub fn verify_with_hello(app: &AppHandle) -> bool {
    if let Some(seam) = hello_seam() {
        return seam == "ok";
    }
    #[cfg(windows)]
    {
        use windows::Security::Credentials::UI::{UserConsentVerificationResult, UserConsentVerifier};
        use windows::Win32::Foundation::HWND;
        use windows::Win32::System::WinRT::IUserConsentVerifierInterop;
        use windows::core::HSTRING;
        use windows_future::IAsyncOperation;
        let Some(hwnd) = app.get_webview_window("main").and_then(|w| w.hwnd().ok()) else { return false };
        let message = HSTRING::from("Unlock Fin");
        let result = (|| -> windows::core::Result<UserConsentVerificationResult> {
            let interop = windows::core::factory::<UserConsentVerifier, IUserConsentVerifierInterop>()?;
            // SAFETY: a live window handle from Tauri; the call only shows Windows' own prompt.
            let op: IAsyncOperation<UserConsentVerificationResult> =
                unsafe { interop.RequestVerificationForWindowAsync(HWND(hwnd.0 as _), &message)? };
            op.join()
        })();
        result.is_ok_and(|r| r == UserConsentVerificationResult::Verified)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        false
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn windows_protects_the_key_for_this_account() {
        let key = DbKey::generate();
        let sealed = protect(key.as_bytes()).expect("DPAPI seals");
        assert_ne!(&sealed[..], &key.as_bytes()[..]);
        assert_eq!(unprotect(&sealed).as_deref(), Some(&key.as_bytes()[..]));
        assert_eq!(unprotect(b"not a protected blob"), None);
    }

    #[test]
    fn a_key_file_is_made_once_and_read_back() {
        if throwaway_data() {
            return; // The test seam would answer instead of DPAPI.
        }
        let dir = std::env::temp_dir().join(format!("fin-keyfile-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(load_key(&dir).is_none());
        let made = create_key(&dir).expect("a new key");
        assert_eq!(load_key(&dir), Some(made));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
