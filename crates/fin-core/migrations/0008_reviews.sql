
-- Monthly reviews (US14): a month the user reviewed, or chose not to be reminded about.
CREATE TABLE month_reviews (
  id    TEXT PRIMARY KEY,
  month TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('reviewed', 'dismissed')),
  at    TEXT NOT NULL
);
