//! The language the command line speaks, Chinese or English, picked as the app picks its own
//! (`S.settings.lang || detectLang()` in `app.js`): the language set in the app (`custom.json`'s `settings.lang`; until
//! the app has written that file, the earlier `settings.json`'s under it, as `readSettings` reads them), else the
//! system's, as the web view's `navigator.language` has it — the user's preferred language on macOS and Windows, the
//! locale's environment (`LC_ALL`, `LC_MESSAGES`, `LANG`) elsewhere and when the system says none — else Chinese, as
//! `detectLang()` falls back to. What the app answers (a tool's error, its progress) is in the words it says them in.

use std::fs;
use std::path::Path;

use serde_json::Value;

/// The most of a settings file read to find the language.
const MAX_SETTINGS: u64 = 8 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lang {
    En,
    Zh,
}

impl Lang {
    /// `en` in English, `zh` in Chinese.
    pub fn pick<T>(self, en: T, zh: T) -> T {
        match self {
            Lang::En => en,
            Lang::Zh => zh,
        }
    }

    /// The language for the data folder `data`, as in the module's notes.
    pub fn detect(data: Option<&Path>) -> Lang {
        data.and_then(app_setting)
            .or_else(|| system().as_deref().map(of_tag))
            .or_else(|| from_env(|k| std::env::var(k).ok()))
            .unwrap_or(Lang::Zh)
    }
}

fn read_json(path: &Path) -> Option<Value> {
    let file = fs::File::open(path).ok()?;
    if file.metadata().ok()?.len() > MAX_SETTINGS {
        return None;
    }
    serde_json::from_reader(std::io::BufReader::new(file)).ok()
}

fn lang_in(settings: Option<&Value>) -> Option<Lang> {
    match settings?.get("lang")?.as_str()? {
        "zh" => Some(Lang::Zh),
        "en" => Some(Lang::En),
        _ => None,
    }
}

/// The language chosen in the app, if one is.
fn app_setting(data: &Path) -> Option<Lang> {
    let custom = read_json(&data.join("custom.json"));
    let own = lang_in(custom.as_ref().and_then(|c| c.get("settings")));
    // a custom.json the app wrote holds all its settings; before it has, settings.json's are read under it
    if custom.as_ref().and_then(|c| c.get("by")).and_then(Value::as_str) == Some("app") {
        return own;
    }
    own.or_else(|| lang_in(read_json(&data.join("settings.json")).as_ref()))
}

/// The locale's environment, the first of `LC_ALL`, `LC_MESSAGES` and `LANG` that is set.
pub fn from_env(get: impl Fn(&str) -> Option<String>) -> Option<Lang> {
    ["LC_ALL", "LC_MESSAGES", "LANG"].iter().find_map(|k| get(k).filter(|v| !v.trim().is_empty())).map(|v| of_tag(&v))
}

/// A locale or language tag's language (`zh_CN.UTF-8`, `zh-Hans-CN`, `en_US`, `C`).
fn of_tag(tag: &str) -> Lang {
    if tag.trim().to_ascii_lowercase().starts_with("zh") {
        Lang::Zh
    } else {
        Lang::En
    }
}

/// The user's first preferred language, as the web view's `navigator.language` has it.
#[cfg(target_os = "macos")]
fn system() -> Option<String> {
    use std::ffi::{c_char, c_void, CStr};
    type Ref = *const c_void;
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFLocaleCopyPreferredLanguages() -> Ref;
        fn CFArrayGetCount(array: Ref) -> isize;
        fn CFArrayGetValueAtIndex(array: Ref, index: isize) -> Ref;
        fn CFStringGetCString(string: Ref, buffer: *mut c_char, size: isize, encoding: u32) -> u8;
        fn CFRelease(object: Ref);
    }
    const UTF8: u32 = 0x0800_0100;
    // SAFETY: the array is the caller's to release (a Copy function), and is released once; its first value is a
    // string it holds while it is not released; the buffer is as long as it is said to be and is ended with a nul.
    unsafe {
        let languages = CFLocaleCopyPreferredLanguages();
        if languages.is_null() {
            return None;
        }
        let mut buffer = [0 as c_char; 64];
        let first = (CFArrayGetCount(languages) > 0).then(|| CFArrayGetValueAtIndex(languages, 0));
        let got = first.is_some_and(|s| !s.is_null() && CFStringGetCString(s, buffer.as_mut_ptr(), buffer.len() as isize, UTF8) != 0);
        let tag = got.then(|| CStr::from_ptr(buffer.as_ptr()).to_string_lossy().into_owned());
        CFRelease(languages);
        tag
    }
}

/// The user's display language.
#[cfg(windows)]
fn system() -> Option<String> {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetUserDefaultUILanguage() -> u16;
    }
    // SAFETY: no arguments; it reads the user's setting
    let id = unsafe { GetUserDefaultUILanguage() };
    // the primary language is the low 10 bits; LANG_CHINESE is 0x04
    Some(if id & 0x3ff == 0x04 { "zh" } else { "en" }.to_string())
}

/// Elsewhere the web view takes the language from the locale's environment.
#[cfg(not(any(target_os = "macos", windows)))]
fn system() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |k| map.get(k).cloned()
    }

    #[test]
    fn reads_the_locale_in_its_order() {
        assert_eq!(from_env(env(&[("LANG", "zh_CN.UTF-8")])), Some(Lang::Zh));
        assert_eq!(from_env(env(&[("LANG", "zh_CN.UTF-8"), ("LC_ALL", "en_US.UTF-8")])), Some(Lang::En));
        assert_eq!(from_env(env(&[("LANG", "en_US.UTF-8"), ("LC_MESSAGES", "zh_TW")])), Some(Lang::Zh));
        assert_eq!(from_env(env(&[("LC_ALL", ""), ("LANG", "zh_HK")])), Some(Lang::Zh));
        assert_eq!(from_env(env(&[("LANG", "C")])), Some(Lang::En));
        assert_eq!(from_env(env(&[])), None);
        assert_eq!(of_tag("zh-Hans-CN"), Lang::Zh);
        assert_eq!(of_tag("fr-FR"), Lang::En);
    }

    #[test]
    fn the_apps_own_setting_comes_first() {
        let dir = tempfile::tempdir().unwrap();
        let at = |name: &str, text: &str| fs::write(dir.path().join(name), text).unwrap();
        assert_eq!(app_setting(dir.path()), None);
        at("custom.json", r#"{"by": "app", "settings": {"lang": "zh", "scale": 2}}"#);
        assert_eq!(app_setting(dir.path()), Some(Lang::Zh));
        assert_eq!(Lang::detect(Some(dir.path())), Lang::Zh);
        at("custom.json", r#"{"by": "app", "settings": {"lang": "en"}}"#);
        assert_eq!(Lang::detect(Some(dir.path())), Lang::En);
        // following the system ("" in the defaults), or a file that is not JSON: no setting
        at("custom.json", r#"{"by": "app", "settings": {"lang": ""}}"#);
        assert_eq!(app_setting(dir.path()), None);
        at("custom.json", "not json");
        assert_eq!(app_setting(dir.path()), None);
    }

    #[test]
    fn the_earlier_settings_json_until_the_app_has_written_custom_json() {
        let dir = tempfile::tempdir().unwrap();
        let at = |name: &str, text: &str| fs::write(dir.path().join(name), text).unwrap();
        at("settings.json", r#"{"lang": "zh", "scale": 2}"#);
        assert_eq!(app_setting(dir.path()), Some(Lang::Zh), "no custom.json yet");
        at("custom.json", r#"{"settings": {"scale": 1}}"#);
        assert_eq!(app_setting(dir.path()), Some(Lang::Zh), "one written by hand: settings.json's under it");
        at("custom.json", r#"{"settings": {"lang": "en"}}"#);
        assert_eq!(app_setting(dir.path()), Some(Lang::En), "its own over settings.json's");
        at("custom.json", r#"{"by": "app", "settings": {}}"#);
        assert_eq!(app_setting(dir.path()), None, "the app's: settings.json no longer read");
    }

    #[test]
    fn picks() {
        assert_eq!(Lang::En.pick("a", "b"), "a");
        assert_eq!(Lang::Zh.pick("a", "b"), "b");
    }
}
