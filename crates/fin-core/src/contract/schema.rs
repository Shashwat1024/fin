//! A small validator that behaves like the Zod 4 schemas in `src/shared/schemas.ts`: the same
//! accept/reject decisions, the same cleaned output (strings trimmed, unknown keys dropped) and the
//! same issues (`path`, `message`), in the same order. The interface shows these messages next to
//! fields, so they must match word for word. `tests/contract_vectors.rs` proves it against Zod.
//!
//! Rules copied from Zod 4:
//! - A wrong type gives one `invalid_type` issue and nothing else is checked for that value.
//! - Length, range and format checks are "continuable": all of them run and report.
//! - Custom refinements run only if the value has no issues so far (including its children).

use std::sync::LazyLock;

use regex::Regex;
use serde_json::{Map, Value};

pub type Issue = (String, String);
pub type Refine = fn(&Value) -> bool;

#[derive(Clone)]
pub enum Check {
    Trim,
    MinLen(usize, Option<&'static str>),
    MaxLen(usize, Option<&'static str>),
    Pattern(&'static LazyLock<Regex>, &'static str),
    SafeInt,
    Min(i64, Option<&'static str>),
    Max(i64, Option<&'static str>),
    /// Predicate, message, extra path below the value (objects).
    Custom(Refine, &'static str, &'static [&'static str]),
}

#[derive(Clone)]
pub enum Kind {
    Str,
    Num,
    Bool,
    Enum(&'static [&'static str]),
    Literal(Value),
    Array(Box<Schema>),
    Object(Vec<(&'static str, Schema)>),
    Optional(Box<Schema>),
    Nullable(Box<Schema>),
    Union(Vec<Schema>),
    Discriminated(&'static str, Vec<(&'static str, Schema)>),
}

#[derive(Clone)]
pub struct Schema {
    pub kind: Kind,
    pub checks: Vec<Check>,
}

// ---- builders -------------------------------------------------------------------------------

fn of(kind: Kind) -> Schema {
    Schema { kind, checks: Vec::new() }
}
pub fn string() -> Schema {
    of(Kind::Str)
}
pub fn number() -> Schema {
    of(Kind::Num)
}
pub fn int() -> Schema {
    number().check(Check::SafeInt)
}
pub fn boolean() -> Schema {
    of(Kind::Bool)
}
pub fn enumeration(values: &'static [&'static str]) -> Schema {
    of(Kind::Enum(values))
}
pub fn literal(v: Value) -> Schema {
    of(Kind::Literal(v))
}
pub fn array(item: Schema) -> Schema {
    of(Kind::Array(Box::new(item)))
}
pub fn object(fields: Vec<(&'static str, Schema)>) -> Schema {
    of(Kind::Object(fields))
}
pub fn union(options: Vec<Schema>) -> Schema {
    of(Kind::Union(options))
}
pub fn discriminated(key: &'static str, options: Vec<(&'static str, Schema)>) -> Schema {
    of(Kind::Discriminated(key, options))
}

impl Schema {
    pub fn check(mut self, c: Check) -> Self {
        self.checks.push(c);
        self
    }
    pub fn trim(self) -> Self {
        self.check(Check::Trim)
    }
    pub fn min_len(self, n: usize) -> Self {
        self.check(Check::MinLen(n, None))
    }
    pub fn min_len_msg(self, n: usize, msg: &'static str) -> Self {
        self.check(Check::MinLen(n, Some(msg)))
    }
    pub fn max_len(self, n: usize) -> Self {
        self.check(Check::MaxLen(n, None))
    }
    pub fn pattern(self, re: &'static LazyLock<Regex>, source: &'static str) -> Self {
        self.check(Check::Pattern(re, source))
    }
    pub fn min(self, n: i64) -> Self {
        self.check(Check::Min(n, None))
    }
    pub fn min_msg(self, n: i64, msg: &'static str) -> Self {
        self.check(Check::Min(n, Some(msg)))
    }
    pub fn max(self, n: i64) -> Self {
        self.check(Check::Max(n, None))
    }
    pub fn refine(self, f: Refine, msg: &'static str) -> Self {
        self.check(Check::Custom(f, msg, &[]))
    }
    pub fn refine_at(self, f: Refine, msg: &'static str, path: &'static [&'static str]) -> Self {
        self.check(Check::Custom(f, msg, path))
    }
    pub fn optional(self) -> Self {
        of(Kind::Optional(Box::new(self)))
    }
    pub fn nullable(self) -> Self {
        of(Kind::Nullable(Box::new(self)))
    }
    /// `z.object(...).partial()`: every field becomes optional.
    pub fn partial(self) -> Self {
        match self.kind {
            Kind::Object(fields) => Schema {
                kind: Kind::Object(fields.into_iter().map(|(k, s)| (k, s.optional())).collect()),
                checks: Vec::new(),
            },
            _ => self,
        }
    }
    /// `z.object(...).pick({...})` / `.omit({...})` / `.extend({...})`.
    pub fn pick(self, keys: &[&str]) -> Self {
        self.retain(|k| keys.contains(&k))
    }
    pub fn omit(self, keys: &[&str]) -> Self {
        self.retain(|k| !keys.contains(&k))
    }
    fn retain(self, keep: impl Fn(&str) -> bool) -> Self {
        match self.kind {
            Kind::Object(fields) => {
                Schema { kind: Kind::Object(fields.into_iter().filter(|(k, _)| keep(k)).collect()), checks: Vec::new() }
            }
            _ => self,
        }
    }
    pub fn extend(self, more: Vec<(&'static str, Schema)>) -> Self {
        match self.kind {
            Kind::Object(mut fields) => {
                for (k, s) in more {
                    match fields.iter_mut().find(|(f, _)| *f == k) {
                        Some(slot) => slot.1 = s,
                        None => fields.push((k, s)),
                    }
                }
                Schema { kind: Kind::Object(fields), checks: Vec::new() }
            }
            _ => self,
        }
    }
}

// ---- validation -------------------------------------------------------------------------------

/// Zod's name for the type it received.
fn received(v: Option<&Value>) -> &'static str {
    match v {
        None => "undefined",
        Some(Value::Null) => "null",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
        Some(Value::String(_)) => "string",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
    }
}

fn js_number(n: i64) -> String {
    n.to_string()
}

struct Ctx<'a> {
    path: Vec<String>,
    issues: &'a mut Vec<Issue>,
    /// Issues from parsing (wrong type, invalid option...), which stop refinements from running.
    /// Issues from checks (length, range, format, refine) do not.
    fatal: usize,
}

impl Ctx<'_> {
    fn push(&mut self, extra: &[&str], message: impl Into<String>) {
        let mut p = self.path.clone();
        p.extend(extra.iter().map(|s| s.to_string()));
        self.issues.push((p.join("."), message.into()));
    }
    fn invalid_type(&mut self, expected: &str, got: Option<&Value>) {
        self.fail(&[], format!("Invalid input: expected {expected}, received {}", received(got)));
    }
    fn fail(&mut self, extra: &[&str], message: impl Into<String>) {
        self.fatal += 1;
        self.push(extra, message);
    }
}

/// After a wrong type, Zod still runs length checks on anything that has a length (a string or
/// an array), worded for the value it actually got: a string field given `[]` also reports
/// "Too small: expected array to have >=1 items".
fn length_checks_after_type_error(checks: &[Check], got: Option<&Value>, ctx: &mut Ctx) {
    let Some(v @ (Value::String(_) | Value::Array(_))) = got else { return };
    let mut v = v.clone();
    let only_length: Vec<Check> =
        checks.iter().filter(|c| matches!(c, Check::MinLen(..) | Check::MaxLen(..))).cloned().collect();
    let fatal = ctx.fatal;
    run_checks(&only_length, &mut v, ctx, fatal);
}

fn literal_text(v: &Value) -> String {
    match v {
        Value::String(s) => format!("\"{s}\""),
        other => other.to_string(),
    }
}

fn run_checks(checks: &[Check], value: &mut Value, ctx: &mut Ctx, fatal_before: usize) {
    for c in checks {
        match c {
            Check::Trim => {
                if let Value::String(s) = value {
                    *s = crate::domain::money::js_trim(s).to_owned();
                }
            }
            Check::MinLen(n, msg) => {
                let (len, unit, kind) = length_of(value);
                if len < *n {
                    let m = msg
                        .map(str::to_owned)
                        .unwrap_or_else(|| format!("Too small: expected {kind} to have >={n} {unit}"));
                    ctx.push(&[], m);
                }
            }
            Check::MaxLen(n, msg) => {
                let (len, unit, kind) = length_of(value);
                if len > *n {
                    let m = msg
                        .map(str::to_owned)
                        .unwrap_or_else(|| format!("Too big: expected {kind} to have <={n} {unit}"));
                    ctx.push(&[], m);
                }
            }
            Check::Pattern(re, source) => {
                if let Value::String(s) = value
                    && !re.is_match(s)
                {
                    ctx.push(&[], format!("Invalid string: must match pattern {source}"));
                }
            }
            Check::SafeInt => {
                let f = value.as_f64().unwrap_or(f64::NAN);
                if f.fract() != 0.0 {
                    ctx.push(&[], "Invalid input: expected int, received number");
                } else if f > crate::domain::money::MAX_SAFE as f64 {
                    ctx.push(&[], format!("Too big: expected int to be <={}", crate::domain::money::MAX_SAFE));
                } else if f < -(crate::domain::money::MAX_SAFE as f64) {
                    ctx.push(&[], format!("Too small: expected int to be >=-{}", crate::domain::money::MAX_SAFE));
                }
            }
            Check::Min(n, msg) => {
                if value.as_f64().is_some_and(|f| f < *n as f64) {
                    let m = msg
                        .map(str::to_owned)
                        .unwrap_or_else(|| format!("Too small: expected number to be >={}", js_number(*n)));
                    ctx.push(&[], m);
                }
            }
            Check::Max(n, msg) => {
                if value.as_f64().is_some_and(|f| f > *n as f64) {
                    let m = msg
                        .map(str::to_owned)
                        .unwrap_or_else(|| format!("Too big: expected number to be <={}", js_number(*n)));
                    ctx.push(&[], m);
                }
            }
            Check::Custom(f, msg, extra) => {
                if ctx.fatal == fatal_before && !f(value) {
                    ctx.push(extra, *msg);
                }
            }
        }
    }
}

/// Length as Zod measures it: strings by character, arrays by item.
fn length_of(v: &Value) -> (usize, &'static str, &'static str) {
    match v {
        Value::String(s) => (s.chars().count(), "characters", "string"),
        Value::Array(a) => (a.len(), "items", "array"),
        _ => (0, "", ""),
    }
}

fn run(schema: &Schema, input: Option<&Value>, ctx: &mut Ctx) -> Option<Value> {
    let fatal_before = ctx.fatal;
    let mut out: Value = match &schema.kind {
        Kind::Optional(inner) => {
            return match input {
                None => None,
                Some(v) => run(inner, Some(v), ctx),
            };
        }
        Kind::Nullable(inner) => {
            return match input {
                Some(Value::Null) => Some(Value::Null),
                other => run(inner, other, ctx),
            };
        }
        Kind::Str => match input {
            Some(v @ Value::String(_)) => v.clone(),
            other => {
                ctx.invalid_type("string", other);
                length_checks_after_type_error(&schema.checks, other, ctx);
                return None;
            }
        },
        Kind::Num => match input {
            Some(v @ Value::Number(_)) => v.clone(),
            other => {
                ctx.invalid_type("number", other);
                length_checks_after_type_error(&schema.checks, other, ctx);
                return None;
            }
        },
        Kind::Bool => match input {
            Some(v @ Value::Bool(_)) => v.clone(),
            other => {
                ctx.invalid_type("boolean", other);
                length_checks_after_type_error(&schema.checks, other, ctx);
                return None;
            }
        },
        Kind::Enum(values) => match input {
            Some(Value::String(s)) if values.contains(&s.as_str()) => Value::String(s.clone()),
            _ => {
                let list: Vec<String> = values.iter().map(|v| format!("\"{v}\"")).collect();
                ctx.fail(&[], format!("Invalid option: expected one of {}", list.join("|")));
                return None;
            }
        },
        Kind::Literal(want) => match input {
            Some(v) if v == want => v.clone(),
            _ => {
                ctx.fail(&[], format!("Invalid input: expected {}", literal_text(want)));
                return None;
            }
        },
        Kind::Union(options) => {
            for o in options {
                let mut scratch = Vec::new();
                let mut sub = Ctx { path: ctx.path.clone(), issues: &mut scratch, fatal: 0 };
                if let Some(v) = run(o, input, &mut sub)
                    && scratch.is_empty()
                {
                    return Some(v);
                }
            }
            ctx.fail(&[], "Invalid input");
            return None;
        }
        Kind::Discriminated(key, options) => {
            let Some(Value::Object(map)) = input else {
                ctx.invalid_type("object", input);
                return None;
            };
            let tag = map.get(*key).and_then(Value::as_str);
            match options.iter().find(|(t, _)| Some(*t) == tag) {
                Some((_, s)) => return run(s, input, ctx),
                None => {
                    let list: Vec<String> = options.iter().map(|(t, _)| format!("'{t}'")).collect();
                    ctx.fail(&[key], format!("Invalid discriminator value. Expected {}", list.join(" | ")));
                    return None;
                }
            }
        }
        Kind::Array(item) => {
            let Some(Value::Array(items)) = input else {
                ctx.invalid_type("array", input);
                length_checks_after_type_error(&schema.checks, input, ctx);
                return None;
            };
            let mut cleaned = Vec::with_capacity(items.len());
            for (i, v) in items.iter().enumerate() {
                ctx.path.push(i.to_string());
                let r = run(item, Some(v), ctx);
                ctx.path.pop();
                cleaned.push(r.unwrap_or(Value::Null));
            }
            Value::Array(cleaned)
        }
        Kind::Object(fields) => {
            let Some(Value::Object(map)) = input else {
                ctx.invalid_type("object", input);
                return None;
            };
            let mut cleaned = Map::new();
            for (k, s) in fields {
                ctx.path.push((*k).to_owned());
                let r = run(s, map.get(*k), ctx);
                ctx.path.pop();
                if let Some(v) = r {
                    cleaned.insert((*k).to_owned(), v);
                }
            }
            Value::Object(cleaned)
        }
    };
    run_checks(&schema.checks, &mut out, ctx, fatal_before);
    Some(out)
}

/// Validate one request payload (`None` = undefined). `Ok` carries the cleaned value.
pub fn validate(schema: &Schema, input: Option<&Value>) -> Result<Option<Value>, Vec<Issue>> {
    let mut issues = Vec::new();
    let mut ctx = Ctx { path: Vec::new(), issues: &mut issues, fatal: 0 };
    let out = run(schema, input, &mut ctx);
    if issues.is_empty() { Ok(out) } else { Err(issues) }
}
