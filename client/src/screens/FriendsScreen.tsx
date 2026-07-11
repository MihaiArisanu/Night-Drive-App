import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, TextInput, ActivityIndicator, Alert, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, CheckCircle, AlertCircle, Info } from "lucide-react-native";
import { useSettingsStore } from '../store/useSettingsStore';
import { useFriendRequests, useAllFriends } from '../hooks/useFriendRequests';
import { useRideInvite } from '../hooks/useRideInvite';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useLocation } from '../hooks/useLocation';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { useGroupInvites } from '../hooks/useGroupInvites';
import { GroupDetails, useGroupDetails } from '../hooks/useGroupDetails';
import { GroupMember } from '../store/useSettingsStore';

export default function FriendsScreen({ navigation, route }: any) {
    const [activeTab, setActiveTab] = useState(route?.params?.initialTab || 'Friends');
    const [sentFriendRequests, setSentFriendRequests] = useState<Set<string>>(new Set());

    const [searchTag, setSearchTag] = useState('');
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

    const { currentUser } = useCurrentUser();
    const { pendingRequests, isSearching, sendFriendRequest, respondToRequest } = useFriendRequests();
    const {
        setActiveGroupId,
        pendingGroupInvites,
        userId
    } = useSettingsStore();
    const { sendInvite } = useRideInvite();
    const { acceptGroupInvite, declineGroupInvite } = useGroupInvites();
    const { groupDetails, isLoading: isGroupLoading, refreshGroupDetails } = useGroupDetails();

    const { coords } = useLocation();
    const { friends, refetchFriends } = useAllFriends();

    useEffect(() => {
        const requestedTab = route?.params?.initialTab;
        if (requestedTab && ['Friends', 'Group', 'Notifications'].includes(requestedTab)) {
            setActiveTab(requestedTab);
        }
    }, [route?.params?.initialTab]);

    const allNotifications = [
        ...pendingRequests.map(req => ({
            id: `friend_${req.id}`,
            text: `${req.name} added you as a friend`,
            type: 'friend_request' as const,
            originalId: req.id
        })),
        ...pendingGroupInvites.map(inv => ({
            id: `group_${inv.id}`,
            text: `${inv.senderName} invited you in a ride group`,
            type: 'group_invite' as const,
            originalId: inv.id,
            groupId: inv.groupId
        }))
    ];

    const handleAddFriend = async () => {
        setFeedback(null);
        const result = await sendFriendRequest(searchTag);
        switch (result.status) {
            case 'success':
                setFeedback({ type: 'success', text: `Request sent to ${result.name}! ✓` });
                setSearchTag("");
                break;
            case 'friendship_repaired':
                setFeedback({ type: 'success', text: `Friendship with ${result.name} restored! ✓` });
                setSearchTag("");
                await refetchFriends();
                break;
            case 'not_found':
                setFeedback({ type: 'error', text: 'No driver found with this TAG.' });
                break;
            case 'already_friends':
                setFeedback({ type: 'info', text: 'You are already friends with this driver.' });
                break;
            case 'already_pending':
                setFeedback({ type: 'info', text: 'Your friend request is already pending.' });
                break;
            case 'incoming_pending':
                setFeedback({ type: 'info', text: 'This driver already sent you a request. Check Notifications.' });
                break;
            case 'self':
                setFeedback({ type: 'info', text: 'Cannot send a friend request to yourself.' });
                break;
            case 'error':
                setFeedback({ type: 'error', text: result.message ?? 'Unknown error.' });
                break;
        }
    };

    const handleInviteToGroup = async (userId: string) => {
        const result = await sendInvite(userId, currentUser?.name || 'Driver', coords.latitude, coords.longitude);
        if (result.success && result.groupId) {
            Alert.alert("Success", "Invite sent. The group will start after it is accepted.");
            await refreshGroupDetails();
        } else {
            Alert.alert("Error", "Failed to send invite.");
        }
    };

    const handleAddGroupMemberFriend = async (member: GroupMember) => {
        const result = await sendFriendRequest(member.tag);
        switch (result.status) {
            case 'success':
            case 'already_pending':
                setSentFriendRequests((current) => new Set(current).add(member.id));
                Alert.alert('Friend request', result.status === 'success' ? `Request sent to ${member.name}.` : 'Friend request already pending.');
                break;
            case 'already_friends':
            case 'friendship_repaired':
                await refreshGroupDetails();
                break;
            case 'incoming_pending':
                Alert.alert('Friend request', 'This person already sent you a request. Check Notifications.');
                break;
            default:
                Alert.alert('Error', 'Could not send the friend request.');
        }
    };

    const groupRelationship = (memberId: string, details: GroupDetails | null) => {
        if (!details) return null;
        if (details.members.some((member) => member.id === memberId)) return 'member';
        if (details.pending.some((member) => member.id === memberId)) return 'pending';
        return null;
    };

    const handleGroupInviteResponse = async (inviteId: string, action: 'accept' | 'decline') => {
        const invite = pendingGroupInvites.find((item) => item.id === inviteId);
        if (!invite) return;

        const succeeded = action === 'accept'
            ? await acceptGroupInvite(invite)
            : await declineGroupInvite(invite);
        if (!succeeded) {
            Alert.alert('Error', `Could not ${action} this group invite. Please try again.`);
            return;
        }
        if (action === 'accept') {
            setActiveGroupId(invite.groupId);
        }
    };

    const handleFriendRequestResponse = async (requestId: string, action: 'accept' | 'reject') => {
        const succeeded = await respondToRequest(requestId, action);
        if (!succeeded) {
            Alert.alert('Error', `Could not ${action} this friend request. Please try again.`);
            return;
        }
        if (action === 'accept') {
            await refetchFriends();
        }
    };

    const handleRemoveFriend = () => {
        Alert.alert("Notice", "Unfriending API is not implemented on the backend yet.");
    };

    const renderFriendsTab = () => (
        <View style={styles.tabContent}>
            <View style={{ marginBottom: 20 }}>
                <View style={styles.actionHeader}>
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Add friend by #Tag"
                        placeholderTextColor="#71717A"
                        value={searchTag}
                        onChangeText={(t) => { setSearchTag(t); setFeedback(null); }}
                        autoCapitalize="characters"
                    />
                    <TouchableOpacity
                        style={[styles.primaryButton, (!searchTag || isSearching) && { opacity: 0.7 }]}
                        onPress={handleAddFriend}
                        disabled={!searchTag || isSearching}
                    >
                        {isSearching ? (
                            <ActivityIndicator color="white" size="small" />
                        ) : (
                            <Text style={styles.primaryButtonText}>Add</Text>
                        )}
                    </TouchableOpacity>
                </View>

                {feedback && (
                    <View style={[
                        styles.feedbackRow,
                        feedback.type === 'success' && styles.feedbackSuccess,
                        feedback.type === 'error' && styles.feedbackError,
                        feedback.type === 'info' && styles.feedbackInfo,
                    ]}>
                        {feedback.type === 'success' && <CheckCircle color="#10B981" size={16} />}
                        {feedback.type === 'error' && <AlertCircle color="#EF4444" size={16} />}
                        {feedback.type === 'info' && <Info color="#F59E0B" size={16} />}
                        <Text style={[
                            styles.feedbackText,
                            feedback.type === 'success' && { color: '#10B981' },
                            feedback.type === 'error' && { color: '#EF4444' },
                            feedback.type === 'info' && { color: '#F59E0B' },
                        ]}>{feedback.text}</Text>
                    </View>
                )}
            </View>

            <FlatList
                data={friends}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 20 }}
                ListEmptyComponent={() => (
                    <Text style={{ color: '#71717A', textAlign: 'center', marginTop: 30, fontSize: 14 }}>No friends yet.</Text>
                )}
                renderItem={({ item }) => (
                    <View style={styles.card}>
                        <View style={styles.friendIdentity}>
                            <ProfileAvatar
                                profilePictureUrl={item.profile_picture_url}
                                size={46}
                                style={styles.friendAvatar}
                            />
                            <View style={styles.friendTextContainer}>
                                <Text style={styles.cardTitle}>{item.username}</Text>
                                <Text style={styles.cardSubtitle}>#{item.tag}</Text>
                            </View>
                        </View>
                        <View style={styles.buttonRow}>
                            {(() => {
                                const relationship = groupRelationship(item.id, groupDetails);
                                return (
                            <TouchableOpacity
                                style={[styles.actionButton, relationship && styles.disabledButton]}
                                onPress={() => handleInviteToGroup(item.id)}
                                disabled={!!relationship}
                            >
                                <Text style={styles.actionButtonText}>
                                    {relationship === 'member' ? 'In Group' : relationship === 'pending' ? 'Invited' : 'Invite to Group'}
                                </Text>
                            </TouchableOpacity>
                                );
                            })()}
                            <TouchableOpacity style={styles.dangerButton} onPress={handleRemoveFriend}>
                                <Text style={styles.dangerButtonText}>X</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}
            />
        </View>
    );

    const renderGroupParticipant = (member: GroupMember, isPending: boolean) => (
        <View key={`${isPending ? 'pending' : 'member'}_${member.id}`} style={styles.card}>
            <View style={styles.friendIdentity}>
                <ProfileAvatar profilePictureUrl={member.profile_picture_url} size={46} style={styles.friendAvatar} />
                <View style={styles.friendTextContainer}>
                    <Text style={styles.cardTitle}>{member.name}{member.id === userId ? ' (You)' : ''}</Text>
                    <Text style={styles.cardSubtitle}>#{member.tag}{isPending ? ' · Pending' : ''}</Text>
                </View>
            </View>
            {member.id !== userId && !member.isFriend && (
                <TouchableOpacity
                    style={[styles.primaryButtonSmall, sentFriendRequests.has(member.id) && styles.disabledButton]}
                    onPress={() => handleAddGroupMemberFriend(member)}
                    disabled={sentFriendRequests.has(member.id)}
                >
                    <Text style={styles.primaryButtonTextSmall}>
                        {sentFriendRequests.has(member.id) ? 'Requested' : 'Add Friend'}
                    </Text>
                </TouchableOpacity>
            )}
        </View>
    );

    const renderGroupTab = () => (
        <View style={styles.tabContent}>
            {isGroupLoading && !groupDetails ? (
                <ActivityIndicator color="#A855F7" size="large" />
            ) : !groupDetails ? (
                <Text style={styles.emptyStateText}>You are not currently in a group.</Text>
            ) : (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.groupListContent}>
                    <View style={styles.groupSummary}>
                        <Text style={styles.groupTitle}>CURRENT GROUP</Text>
                        <Text style={styles.groupCount}>{groupDetails.members.length} active · {groupDetails.pending.length} pending</Text>
                    </View>

                    <Text style={styles.sectionLabel}>MEMBERS</Text>
                    {groupDetails.members.map((member) => renderGroupParticipant(member, false))}

                    {groupDetails.pending.length > 0 && (
                        <>
                            <Text style={styles.sectionLabel}>PENDING INVITES</Text>
                            {groupDetails.pending.map((member) => renderGroupParticipant(member, true))}
                        </>
                    )}
                </ScrollView>
            )}
        </View>
    );

    const renderNotificationsTab = () => (
        <View style={styles.tabContent}>
            <FlatList
                data={allNotifications}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 20 }}
                ListEmptyComponent={() => (
                    <Text style={styles.emptyStateText}>No new notifications.</Text>
                )}
                renderItem={({ item }) => (
                    <View style={styles.card}>
                        <Text style={styles.notificationText}>{item.text}</Text>
                        <View style={styles.buttonRow}>
                            <TouchableOpacity
                                style={styles.successButton}
                                onPress={() => {
                                    if (item.type === 'friend_request') {
                                        handleFriendRequestResponse(item.originalId, 'accept');
                                    } else {
                                        handleGroupInviteResponse(item.originalId, 'accept');
                                    }
                                }}
                            >
                                <Text style={styles.successButtonText}>✓</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.dangerButton}
                                onPress={() => {
                                    if (item.type === 'friend_request') {
                                        handleFriendRequestResponse(item.originalId, 'reject');
                                    } else {
                                        handleGroupInviteResponse(item.originalId, 'decline');
                                    }
                                }}
                            >
                                <Text style={styles.dangerButtonText}>X</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}
            />
        </View>
    );

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.navigate("Menu")} style={styles.backButton}>
                    <ArrowLeft color="white" size={28} />
                    <Text style={styles.backText}>BACK</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.tabsContainer}>
                {['Friends', 'Group', 'Notifications'].map((tab) => (
                    <TouchableOpacity
                        key={tab}
                        style={[styles.tabButton, activeTab === tab && styles.activeTabButton]}
                        onPress={() => setActiveTab(tab)}
                    >
                        <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
                            {tab.toUpperCase()}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <View style={styles.mainContainer}>
                {activeTab === 'Friends' && renderFriendsTab()}
                {activeTab === 'Group' && renderGroupTab()}
                {activeTab === 'Notifications' && renderNotificationsTab()}
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#09090B',
        paddingTop: Platform.OS === 'ios' ? 5 : 30,
    },
    header: {
        paddingHorizontal: 15,
        paddingBottom: 10,
    },
    backButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    backText: {
        color: "white",
        fontSize: 16,
        fontWeight: "bold",
    },
    emptyStateText: {
        color: '#71717A',
        textAlign: 'center',
        marginTop: 30,
        fontSize: 14,
    },

    tabsContainer: {
        flexDirection: 'row',
        backgroundColor: '#09090B',
        paddingHorizontal: 15,
        borderBottomWidth: 1,
        borderColor: '#27272A',
        paddingTop: 10,
    },
    tabButton: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
    },
    activeTabButton: {
        borderBottomWidth: 2,
        borderBottomColor: '#A855F7'
    },
    tabText: {
        color: '#71717A',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1
    },
    activeTabText: {
        color: '#F4F4F5'
    },

    mainContainer: {
        flex: 1,
        padding: 15,
        backgroundColor: '#09090B'
    },
    tabContent: {
        flex: 1
    },

    actionHeader: {
        flexDirection: 'row',
        gap: 10
    },
    searchInput: {
        flex: 1,
        backgroundColor: '#18181B',
        borderRadius: 12,
        paddingHorizontal: 15,
        color: '#F4F4F5',
        borderWidth: 1,
        borderColor: '#27272A',
        fontSize: 14,
        height: 50,
    },
    primaryButton: {
        backgroundColor: '#A855F7',
        paddingHorizontal: 20,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 12,
        height: 50
    },
    primaryButtonText: {
        color: '#FFFFFF',
        fontWeight: 'bold',
        fontSize: 14
    },

    feedbackRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 10,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 10,
    },
    feedbackSuccess: {
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
        borderWidth: 1,
        borderColor: 'rgba(16, 185, 129, 0.3)',
    },
    feedbackError: {
        backgroundColor: 'rgba(239, 68, 68, 0.12)',
        borderWidth: 1,
        borderColor: 'rgba(239, 68, 68, 0.3)',
    },
    feedbackInfo: {
        backgroundColor: 'rgba(245, 158, 11, 0.12)',
        borderWidth: 1,
        borderColor: 'rgba(245, 158, 11, 0.3)',
    },
    feedbackText: {
        fontSize: 13,
        fontWeight: '600',
        flex: 1,
    },

    card: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#18181B',
        padding: 15,
        borderRadius: 12,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#27272A'
    },
    friendIdentity: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: 10,
    },
    friendAvatar: {
        borderWidth: 2,
        borderColor: '#A855F7',
        backgroundColor: '#09090B',
    },
    friendTextContainer: {
        marginLeft: 12,
        flexShrink: 1,
    },
    cardTitle: {
        color: '#F4F4F5',
        fontSize: 16,
        fontWeight: '600'
    },
    cardSubtitle: {
        color: '#A1A1AA',
        fontSize: 13,
        marginTop: 2
    },
    notificationText: {
        color: '#F4F4F5',
        fontSize: 14,
        flex: 1,
        marginRight: 10,
        lineHeight: 20
    },

    buttonRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8
    },
    actionButton: {
        backgroundColor: '#27272A',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8
    },
    actionButtonText: {
        color: '#E4E4E7',
        fontSize: 12,
        fontWeight: '600'
    },
    disabledButton: {
        opacity: 0.5,
    },
    primaryButtonSmall: {
        backgroundColor: 'rgba(168, 85, 247, 0.2)',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#A855F7'
    },
    primaryButtonTextSmall: {
        color: '#A855F7',
        fontSize: 12,
        fontWeight: '700'
    },
    groupListContent: {
        paddingBottom: 24,
    },
    groupSummary: {
        backgroundColor: 'rgba(168, 85, 247, 0.12)',
        borderWidth: 1,
        borderColor: 'rgba(168, 85, 247, 0.35)',
        borderRadius: 14,
        padding: 16,
        marginBottom: 20,
    },
    groupTitle: {
        color: '#F4F4F5',
        fontSize: 16,
        fontWeight: '800',
        letterSpacing: 1,
    },
    groupCount: {
        color: '#A1A1AA',
        fontSize: 13,
        marginTop: 5,
    },
    sectionLabel: {
        color: '#A1A1AA',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 1,
        marginBottom: 10,
        marginTop: 4,
    },
    dangerButton: {
        backgroundColor: 'rgba(239, 68, 68, 0.15)',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
    },
    dangerButtonText: {
        color: '#EF4444',
        fontSize: 12,
        fontWeight: 'bold'
    },
    successButton: {
        backgroundColor: 'rgba(34, 197, 94, 0.15)',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
    },
    successButtonText: {
        color: '#22C55E',
        fontSize: 12,
        fontWeight: 'bold'
    },
});
