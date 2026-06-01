CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  username_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT,
  is_guest BOOLEAN NOT NULL DEFAULT FALSE,
  orb_balance INTEGER NOT NULL DEFAULT 0 CHECK (orb_balance >= 0),
  total_orbs_deposited INTEGER NOT NULL DEFAULT 0 CHECK (total_orbs_deposited >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounts_username_normalized ON accounts (username_normalized);

CREATE TABLE IF NOT EXISTS account_skins (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  skin_id TEXT NOT NULL,
  skin_role TEXT NOT NULL CHECK (skin_role IN ('runner', 'void')),
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, skin_id)
);

CREATE INDEX IF NOT EXISTS idx_account_skins_account_id ON account_skins (account_id);

CREATE TABLE IF NOT EXISTS match_rewards (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  lobby_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  orbs_deposited INTEGER NOT NULL CHECK (orbs_deposited >= 0),
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_match_rewards_account_id ON match_rewards (account_id);
CREATE INDEX IF NOT EXISTS idx_match_rewards_match_id ON match_rewards (match_id);
