import React, { useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, TextInput, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import { ArrowLeft, CheckCircle, AlertCircle, Info } from "lucide-react-native";
import { useSettingsStore } from '../store/useSettingsStore';
import { useFriendRequests } from '../hooks/useFriendRequests';
import { useRideInvite } from '../hooks/useRideInvite';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useLocation } from '../hooks/useLocation';
import { useNearbyFriends } from '../hooks/useNearbyFriends';


export default function FriendsScreen({ navigation }: any) {
    const [activeTab, setActiveTab] = useState('Friends');

    const [searchTag, setSearchTag] = useState('');
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

    const { currentUser } = useCurrentUser();
    const { pendingRequests, isSearching, sendFriendRequest, respondToRequest } = useFriendRequests();
    const {
        activeGroupId, setActiveGroupId,
        groupMembers, setGroupMembers,
        pendingGroupInvites, setPendingGroupInvites,
        token, isDNDActive
    } = useSettingsStore();
    const { sendInvite } = useRideInvite();

    const { coords } = useLocation();
    const { friends } = useNearbyFriends(coords.latitude, coords.longitude, isDNDActive, token);

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
            case 'not_found':
                setFeedback({ type: 'error', text: 'No driver found with this TAG.' });
                break;
            case 'already_friends':
                setFeedback({ type: 'info', text: 'You are already friends with this driver.' });
                break;
            case 'self':
                setFeedback({ type: 'info', text: 'Cannot send a friend request to yourself.' });
                break;
            case 'error':
                setFeedback({ type: 'error', text: result.message ?? 'Unknown error.' });
                break;
        }
    };

    const handleAcceptGroup = (inviteId: string, groupId: string) => {
        setActiveGroupId(groupId);
        setPendingGroupInvites(pendingGroupInvites.filter(inv => inv.id !== inviteId));
    };

    const handleInviteToGroup = async (userId: string) => {
        const result = await sendInvite(userId, currentUser?.name || 'Driver', coords.latitude, coords.longitude);
        if (result.success) {
            Alert.alert("Success", "Invite sent successfully!");
        } else {
            Alert.alert("Error", "Failed to send invite.");
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
                        placeholder="Add friend by Name#Tag..."
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
                    <Text style={{ color: '#71717A', textAlign: 'center', marginTop: 30, fontSize: 14 }}>No friends nearby.</Text>
                )}
                renderItem={({ item }) => (
                    <View style={styles.card}>
                        <View>
                            <Text style={styles.cardTitle}>{item.name}</Text>
                            <Text style={styles.cardSubtitle}>Nearby</Text>
                        </View>
                        <View style={styles.buttonRow}>
                            <TouchableOpacity
                                style={styles.actionButton}
                                onPress={() => handleInviteToGroup(item.id)}
                            >
                                <Text style={styles.actionButtonText}>Invite to Group</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.dangerButton} onPress={handleRemoveFriend}>
                                <Text style={styles.dangerButtonText}>X</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}
            />
        </View>
    );

    const renderGroupTab = () => (
        <View style={styles.tabContent}>
            <View style={styles.actionHeader}>
                <TouchableOpacity
                    style={[styles.primaryButton, { flex: 1 }]}
                    onPress={() => setActiveTab('Friends')}
                >
                    <Text style={styles.primaryButtonText}>+ Add Friend to Group</Text>
                </TouchableOpacity>
            </View>

            <FlatList
                data={groupMembers}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 20 }}
                ListEmptyComponent={() => (
                    <Text style={styles.emptyStateText}>You are not currently in a group.</Text>
                )}
                renderItem={({ item }) => (
                    <View style={styles.card}>
                        <View>
                            <Text style={styles.cardTitle}>{item.name}</Text>
                            <Text style={styles.cardSubtitle}>{item.tag}</Text>
                        </View>
                        <View style={styles.buttonRow}>
                            <TouchableOpacity
                                style={styles.primaryButtonSmall}
                                onPress={() => sendFriendRequest(item.tag)}
                            >
                                <Text style={styles.primaryButtonTextSmall}>Add Friend</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}
            />
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
                                        respondToRequest(item.originalId, 'accept');
                                    } else {
                                        handleAcceptGroup(item.originalId, item.groupId!);
                                    }
                                }}
                            >
                                <Text style={styles.successButtonText}>✓</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.dangerButton}
                                onPress={() => {
                                    if (item.type === 'friend_request') {
                                        respondToRequest(item.originalId, 'reject');
                                    } else {
                                        setPendingGroupInvites(pendingGroupInvites.filter(i => i.id !== item.originalId));
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

            {/* TABS NAVIGATION */}
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

            {/* CONTENT */}
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
        paddingTop: 40,
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