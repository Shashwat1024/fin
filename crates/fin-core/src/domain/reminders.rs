//! Reminders (US11): which notifications are due now, from what is expected (recurring payments,
//! card bills, the forecast) and the user's settings. Pure: the caller records what was shown so
//! nothing repeats, and the shell shows them.

use crate::domain::dates::{add_days, format_date};
use crate::domain::money::rupees_exact;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReminderSettings {
    pub recurring: bool,
    pub card_due: bool,
    pub low_cash: bool,
    /// Warranties ending within `WARRANTY_DAYS` (US22).
    pub warranty: bool,
    /// Days before a card bill is due to remind (1–10).
    pub card_notice_days: i64,
    /// "HH:MM"; equal start and end mean no quiet hours.
    pub quiet_start: String,
    pub quiet_end: String,
    pub show_amounts: bool,
}

/// A recurring payment still expected (money out; income is not reminded).
#[derive(Debug, Clone)]
pub struct Payment {
    pub item_id: String,
    pub name: String,
    pub due_date: String,
    pub amount_minor: i64,
    pub overdue: bool,
}

#[derive(Debug, Clone)]
pub struct CardBill {
    pub account_id: String,
    pub name: String,
    pub statement_date: String,
    pub due_date: String,
    pub remaining_minor: i64,
}

/// A receipt with a warranty end date (US22).
#[derive(Debug, Clone)]
pub struct Warranty {
    pub attachment_id: String,
    /// What it was bought from (the transaction's payee), or the file's name.
    pub name: String,
    pub until: String,
}

/// Warranties are reminded this many days before they end.
pub const WARRANTY_DAYS: i64 = 30;

#[derive(Debug, Clone)]
pub struct LowCash {
    /// First day below the buffer.
    pub from: String,
    pub lowest_minor: i64,
    pub lowest_date: String,
    pub buffer_minor: i64,
}

pub struct ReminderInput<'a> {
    pub today: &'a str,
    /// Local time, "HH:MM".
    pub time: &'a str,
    pub settings: &'a ReminderSettings,
    pub payments: &'a [Payment],
    pub cards: &'a [CardBill],
    pub low_cash: Option<&'a LowCash>,
    pub warranties: &'a [Warranty],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reminder {
    /// Stable identity: the same payment or bill always has the same key, so it is shown once.
    pub key: String,
    pub kind: &'static str,
    pub title: String,
    pub body: String,
    pub route: &'static str,
}

/// Overdue items older than this are not reminded (they would all arrive at once after a break).
pub const OVERDUE_REMIND_DAYS: i64 = 7;
/// The forecast looks this far ahead for a drop below the buffer.
pub const LOW_CASH_DAYS: i64 = 7;

/// Whether `time` falls in quiet hours, which may run past midnight (22:00–08:00).
pub fn in_quiet_hours(time: &str, start: &str, end: &str) -> bool {
    if start == end {
        return false;
    }
    if start < end { time >= start && time < end } else { time >= start || time < end }
}

fn day(date: &str) -> String {
    // "12 Nov" from "12 Nov 2026".
    format_date(date).map(|d| d.rsplit_once(' ').map_or(d.clone(), |(dm, _)| dm.to_owned())).unwrap_or_default()
}

pub fn due_reminders(input: &ReminderInput) -> Vec<Reminder> {
    let s = input.settings;
    if in_quiet_hours(input.time, &s.quiet_start, &s.quiet_end) {
        return Vec::new();
    }
    let ad = |n: i64| add_days(input.today, n).unwrap_or_default();
    let (tomorrow, oldest) = (ad(1), ad(-OVERDUE_REMIND_DAYS));
    let money = |minor: i64| rupees_exact(minor);
    let mut out = Vec::new();

    if s.recurring {
        for p in input.payments {
            let (kind, when, title) = if p.overdue && p.due_date >= oldest {
                ("recurring_overdue", "overdue", "Payment overdue")
            } else if !p.overdue && p.due_date == tomorrow {
                ("recurring_due", "tomorrow", "Payment due tomorrow")
            } else {
                continue;
            };
            let body = match (s.show_amounts, p.overdue) {
                (true, false) => format!("{}: {} on {}", p.name, money(p.amount_minor), day(&p.due_date)),
                (true, true) => format!("{}: {} was due on {}", p.name, money(p.amount_minor), day(&p.due_date)),
                (false, false) => format!("A recurring payment is due on {}", day(&p.due_date)),
                (false, true) => format!("A recurring payment was due on {}", day(&p.due_date)),
            };
            out.push(Reminder {
                key: format!("recurring:{}:{}:{when}", p.item_id, p.due_date),
                kind,
                title: title.to_owned(),
                body,
                route: "/recurring",
            });
        }
    }

    if s.card_due {
        let notice_until = ad(s.card_notice_days);
        for c in input.cards.iter().filter(|c| c.remaining_minor > 0) {
            let overdue = c.due_date.as_str() < input.today;
            if overdue && c.due_date < oldest || !overdue && c.due_date > notice_until {
                continue;
            }
            let (when, title) = if overdue { ("overdue", "Card bill overdue") } else { ("due", "Card bill due soon") };
            let verb = if overdue { "was due" } else { "due" };
            let body = if s.show_amounts {
                format!("{}: {} {verb} on {}", c.name, money(c.remaining_minor), day(&c.due_date))
            } else {
                format!("A credit card bill {verb} on {}", day(&c.due_date))
            };
            out.push(Reminder {
                key: format!("card:{}:{}:{when}", c.account_id, c.statement_date),
                kind: "card_due",
                title: title.to_owned(),
                body,
                route: "/accounts",
            });
        }
    }

    if s.warranty {
        let until = ad(WARRANTY_DAYS);
        for w in input.warranties.iter().filter(|w| w.until.as_str() >= input.today && w.until <= until) {
            let body = if s.show_amounts {
                format!("{}: the warranty ends on {}", w.name, day(&w.until))
            } else {
                format!("A warranty ends on {}", day(&w.until))
            };
            out.push(Reminder {
                key: format!("warranty:{}:{}", w.attachment_id, w.until),
                kind: "warranty",
                title: "Warranty ending soon".to_owned(),
                body,
                route: "/warranties",
            });
        }
    }

    if s.low_cash
        && let Some(l) = input.low_cash
        && l.from.as_str() <= ad(LOW_CASH_DAYS).as_str()
    {
        let body = if s.show_amounts {
            format!(
                "Forecast: {} on {}, below your {} buffer",
                money(l.lowest_minor),
                day(&l.lowest_date),
                money(l.buffer_minor)
            )
        } else {
            format!("Your cash is forecast to drop below your buffer on {}", day(&l.from))
        };
        out.push(Reminder {
            key: format!("lowcash:{}", l.from),
            kind: "low_cash",
            title: "Cash may run low".to_owned(),
            body,
            route: "/forecast",
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> ReminderSettings {
        ReminderSettings {
            recurring: true,
            card_due: true,
            low_cash: true,
            warranty: true,
            card_notice_days: 3,
            quiet_start: "22:00".into(),
            quiet_end: "08:00".into(),
            show_amounts: true,
        }
    }
    fn pay(id: &str, due: &str, overdue: bool) -> Payment {
        Payment { item_id: id.into(), name: "Rent".into(), due_date: due.into(), amount_minor: -2_500_000, overdue }
    }
    fn card(due: &str, remaining: i64) -> CardBill {
        CardBill {
            account_id: "acc_1".into(),
            name: "HDFC Card".into(),
            statement_date: "2026-11-01".into(),
            due_date: due.into(),
            remaining_minor: remaining,
        }
    }
    fn run(
        s: &ReminderSettings,
        time: &str,
        payments: &[Payment],
        cards: &[CardBill],
        low: Option<&LowCash>,
    ) -> Vec<Reminder> {
        due_reminders(&ReminderInput {
            today: "2026-11-10",
            time,
            settings: s,
            payments,
            cards,
            low_cash: low,
            warranties: &[],
        })
    }

    #[test]
    fn quiet_hours_may_cross_midnight() {
        assert!(in_quiet_hours("23:30", "22:00", "08:00"));
        assert!(in_quiet_hours("07:59", "22:00", "08:00"));
        assert!(!in_quiet_hours("08:00", "22:00", "08:00"));
        assert!(in_quiet_hours("13:15", "13:00", "14:00"));
        assert!(!in_quiet_hours("14:00", "13:00", "14:00"));
        assert!(!in_quiet_hours("03:00", "00:00", "00:00"));
        assert!(run(&settings(), "23:00", &[pay("r1", "2026-11-11", false)], &[], None).is_empty());
    }

    #[test]
    fn payments_due_tomorrow_or_recently_overdue_are_reminded_once_each() {
        let payments = [
            pay("r1", "2026-11-11", false),
            pay("r2", "2026-11-12", false),
            pay("r3", "2026-11-05", true),
            pay("r4", "2026-10-20", true),
        ];
        let r = run(&settings(), "09:00", &payments, &[], None);
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].key, "recurring:r1:2026-11-11:tomorrow");
        assert_eq!((r[0].title.as_str(), r[0].body.as_str()), ("Payment due tomorrow", "Rent: ₹25,000 on 11 Nov"));
        assert_eq!(r[1].key, "recurring:r3:2026-11-05:overdue");
        assert_eq!(r[1].body, "Rent: ₹25,000 was due on 5 Nov");
        assert_eq!(r[1].route, "/recurring");
    }

    #[test]
    fn card_bills_are_reminded_within_the_notice_period_until_paid() {
        let s = settings();
        assert_eq!(
            run(&s, "09:00", &[], &[card("2026-11-13", 1_240_050)], None)[0].body,
            "HDFC Card: ₹12,400.50 due on 13 Nov"
        );
        assert!(run(&s, "09:00", &[], &[card("2026-11-14", 100)], None).is_empty());
        assert!(run(&s, "09:00", &[], &[card("2026-11-12", 0)], None).is_empty());
        let overdue = run(&s, "09:00", &[], &[card("2026-11-08", 100)], None);
        assert_eq!(
            (overdue[0].title.as_str(), overdue[0].key.as_str()),
            ("Card bill overdue", "card:acc_1:2026-11-01:overdue")
        );
    }

    #[test]
    fn low_cash_within_a_week_and_text_without_amounts() {
        let low = LowCash {
            from: "2026-11-15".into(),
            lowest_minor: 120_000,
            lowest_date: "2026-11-16".into(),
            buffer_minor: 500_000,
        };
        let r = run(&settings(), "09:00", &[], &[], Some(&low));
        assert_eq!(
            (r[0].key.as_str(), r[0].body.as_str()),
            ("lowcash:2026-11-15", "Forecast: ₹1,200 on 16 Nov, below your ₹5,000 buffer")
        );
        let later = LowCash { from: "2026-11-18".into(), ..low.clone() };
        assert!(run(&settings(), "09:00", &[], &[], Some(&later)).is_empty());

        let hidden = ReminderSettings { show_amounts: false, ..settings() };
        let r = run(&hidden, "09:00", &[pay("r1", "2026-11-11", false)], &[card("2026-11-12", 100)], Some(&low));
        let bodies: Vec<&str> = r.iter().map(|x| x.body.as_str()).collect();
        assert_eq!(
            bodies,
            [
                "A recurring payment is due on 11 Nov",
                "A credit card bill due on 12 Nov",
                "Your cash is forecast to drop below your buffer on 15 Nov"
            ]
        );
        assert!(r.iter().all(|x| !x.body.contains("Rent") && !x.body.contains("HDFC")));
    }

    #[test]
    fn warranties_ending_within_thirty_days() {
        let w =
            |id: &str, until: &str| Warranty { attachment_id: id.into(), name: "Croma".into(), until: until.into() };
        let list = [w("a", "2026-12-01"), w("b", "2026-12-20"), w("c", "2026-11-01")];
        let r = due_reminders(&ReminderInput {
            today: "2026-11-10",
            time: "09:00",
            settings: &settings(),
            payments: &[],
            cards: &[],
            low_cash: None,
            warranties: &list,
        });
        assert_eq!(r.len(), 1, "within 30 days and not already over");
        assert_eq!(
            (r[0].key.as_str(), r[0].body.as_str()),
            ("warranty:a:2026-12-01", "Croma: the warranty ends on 1 Dec")
        );
    }

    #[test]
    fn switched_off_kinds_are_not_reminded() {
        let off =
            ReminderSettings { recurring: false, card_due: false, low_cash: false, warranty: false, ..settings() };
        let low =
            LowCash { from: "2026-11-11".into(), lowest_minor: 0, lowest_date: "2026-11-11".into(), buffer_minor: 1 };
        assert!(run(&off, "09:00", &[pay("r1", "2026-11-11", false)], &[card("2026-11-11", 5)], Some(&low)).is_empty());
    }
}
