CREATE TABLE ride_groups (
    id UUID PRIMARY KEY,
    group_type VARCHAR(20) NOT NULL DEFAULT 'planned',
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activated_at TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ride_groups_type_check
        CHECK (group_type IN ('planned', 'spontaneous')),
    CONSTRAINT ride_groups_status_check
        CHECK (status IN ('draft', 'active', 'closed'))
);

CREATE TABLE ride_group_members (
    group_id UUID NOT NULL REFERENCES ride_groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (group_id, user_id),
    CONSTRAINT ride_group_members_status_check
        CHECK (status IN ('active', 'left'))
);

-- A driver can participate in only one current ride group. Draft groups count
-- because their creator is already waiting for invited members.
CREATE UNIQUE INDEX ride_group_members_one_current_group_per_user
    ON ride_group_members(user_id)
    WHERE status = 'active';

CREATE INDEX ride_group_members_active_group_idx
    ON ride_group_members(group_id, joined_at)
    WHERE status = 'active';

CREATE TABLE ride_group_invites (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES ride_groups(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    responded_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT ride_group_invites_status_check
        CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
    CONSTRAINT ride_group_invites_not_self_check
        CHECK (sender_id <> target_user_id)
);

CREATE UNIQUE INDEX ride_group_invites_one_pending_per_target
    ON ride_group_invites(group_id, target_user_id)
    WHERE status = 'pending';

CREATE INDEX ride_group_invites_target_pending_idx
    ON ride_group_invites(target_user_id, created_at DESC)
    WHERE status = 'pending';

CREATE INDEX ride_group_invites_group_pending_idx
    ON ride_group_invites(group_id, created_at)
    WHERE status = 'pending';
