CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  username_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT,
  is_guest BOOLEAN NOT NULL DEFAULT FALSE,
  orb_balance INTEGER NOT NULL DEFAULT 0 CHECK (orb_balance >= 0),
  total_orbs_deposited INTEGER NOT NULL DEFAULT 0 CHECK (total_orbs_deposited >= 0),
  account_level INTEGER NOT NULL DEFAULT 1 CHECK (account_level >= 1),
  account_xp INTEGER NOT NULL DEFAULT 0 CHECK (account_xp >= 0),
  account_total_xp INTEGER NOT NULL DEFAULT 0 CHECK (account_total_xp >= 0),
  runner_level INTEGER NOT NULL DEFAULT 1 CHECK (runner_level >= 1),
  runner_xp INTEGER NOT NULL DEFAULT 0 CHECK (runner_xp >= 0),
  runner_total_xp INTEGER NOT NULL DEFAULT 0 CHECK (runner_total_xp >= 0),
  void_level INTEGER NOT NULL DEFAULT 1 CHECK (void_level >= 1),
  void_xp INTEGER NOT NULL DEFAULT 0 CHECK (void_xp >= 0),
  void_total_xp INTEGER NOT NULL DEFAULT 0 CHECK (void_total_xp >= 0),
  selected_runner_class TEXT NOT NULL DEFAULT 'orbCollector', 
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

CREATE TABLE IF NOT EXISTS account_perks (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  perk_id TEXT NOT NULL,
  perk_role TEXT NOT NULL CHECK (perk_role IN ('survivor', 'killer')),
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1 AND level <= 4),
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, perk_id)
);

CREATE INDEX IF NOT EXISTS idx_account_perks_account_id ON account_perks (account_id);


CREATE TABLE IF NOT EXISTS match_progression_awards (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  lobby_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  player_role TEXT NOT NULL CHECK (player_role IN ('runner', 'void')),
  reason TEXT NOT NULL DEFAULT 'match',
  match_seconds NUMERIC NOT NULL DEFAULT 0,
  base_score INTEGER NOT NULL DEFAULT 0 CHECK (base_score >= 0),
  match_score INTEGER NOT NULL DEFAULT 0 CHECK (match_score >= 0),
  account_xp INTEGER NOT NULL DEFAULT 0 CHECK (account_xp >= 0),
  role_xp INTEGER NOT NULL DEFAULT 0 CHECK (role_xp >= 0),
  orbs_deposited INTEGER NOT NULL DEFAULT 0 CHECK (orbs_deposited >= 0),
  level_reward_orbs INTEGER NOT NULL DEFAULT 0 CHECK (level_reward_orbs >= 0),
  breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  progression_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_match_progression_awards_account_id ON match_progression_awards (account_id);
CREATE INDEX IF NOT EXISTS idx_match_progression_awards_match_id ON match_progression_awards (match_id);
