//! The part of JSON Schema `ui/tools.json`'s input schemas use, enough for the app played here to refuse arguments
//! the real page would: `type` (one or several), `enum`, `anyOf`, `properties`, `required`, `additionalProperties:
//! false`, `items`, `minItems`, `maxItems`, `minimum`, `maximum`, `maxLength`.

use serde_json::Value;

/// Whether `value` is what `schema` describes; else where it is not, and why.
pub fn check(schema: &Value, value: &Value, at: &str) -> Result<(), String> {
    if let Some(any) = schema.get("anyOf").and_then(Value::as_array) {
        if !any.iter().any(|s| check(s, value, at).is_ok()) {
            return Err(format!("{at}: {value} is none of what it may be"));
        }
    }
    if let Some(types) = schema.get("type") {
        let types: Vec<&str> = match types {
            Value::String(t) => vec![t.as_str()],
            Value::Array(ts) => ts.iter().filter_map(Value::as_str).collect(),
            _ => vec![],
        };
        if !types.iter().any(|t| is(value, t)) {
            return Err(format!("{at}: {value} is not {}", types.join(" or ")));
        }
    }
    if let Some(choices) = schema.get("enum").and_then(Value::as_array) {
        if !choices.contains(value) {
            return Err(format!("{at}: {value} is not one of {}", Value::Array(choices.clone())));
        }
    }
    match value {
        Value::Object(fields) => {
            let properties = schema.get("properties").and_then(Value::as_object);
            for name in schema.get("required").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]).iter().filter_map(Value::as_str) {
                if !fields.contains_key(name) {
                    return Err(format!("{at}: {name} is wanted"));
                }
            }
            for (name, field) in fields {
                match properties.and_then(|p| p.get(name)) {
                    Some(s) => check(s, field, &format!("{at}.{name}"))?,
                    None if schema.get("additionalProperties") == Some(&Value::Bool(false)) => {
                        return Err(format!("{at}: {name} is not an argument it takes"));
                    }
                    None => {}
                }
            }
        }
        Value::Array(items) => {
            if let Some(most) = schema.get("maxItems").and_then(Value::as_u64) {
                if items.len() as u64 > most {
                    return Err(format!("{at}: more than {most}"));
                }
            }
            if let Some(least) = schema.get("minItems").and_then(Value::as_u64) {
                if (items.len() as u64) < least {
                    return Err(format!("{at}: fewer than {least}"));
                }
            }
            if let Some(each) = schema.get("items") {
                for (i, item) in items.iter().enumerate() {
                    check(each, item, &format!("{at}[{i}]"))?;
                }
            }
        }
        Value::String(text) => {
            if let Some(most) = schema.get("maxLength").and_then(Value::as_u64) {
                if text.chars().count() as u64 > most {
                    return Err(format!("{at}: longer than {most}"));
                }
            }
        }
        Value::Number(n) => {
            let n = n.as_f64().unwrap_or(f64::NAN);
            if schema.get("minimum").and_then(Value::as_f64).is_some_and(|least| n < least) || schema.get("maximum").and_then(Value::as_f64).is_some_and(|most| n > most) {
                return Err(format!("{at}: {n} is out of range"));
            }
        }
        _ => {}
    }
    Ok(())
}

fn is(value: &Value, kind: &str) -> bool {
    match kind {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "integer" => value.is_i64() || value.is_u64(),
        "number" => value.is_number(),
        "boolean" => value.is_boolean(),
        "null" => value.is_null(),
        _ => true,
    }
}
