import { ArrowLeft, Bookmark, MapPinOff, MessageSquare, Search, UserPlus, X, Users, LogOut, CheckCircle, AlertCircle, Info } from "lucide-react-native";
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Modal, KeyboardAvoidingView, Platform, ActivityIndicator, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState } from "react";
import { ActionButton } from "../components/ActionButton";

import { useDeleteAccount } from "../hooks/useDeleteAccount";
import { useFriendRequests, FriendRequestResult } from "../hooks/useFriendRequests";
import { useSettingsStore } from '../store/useSettingsStore';
import { useCurrentUser } from '../hooks/useCurrentUser';

export default function MenuScreen({ navigation }: any) {
  const { currentUser } = useCurrentUser();
  const { confirmAndDelete, isDeleting } = useDeleteAccount();
  const {
    activeGroupId, setActiveGroupId,
    groupMembers, setGroupMembers,
    pendingGroupInvites, setPendingGroupInvites
  } = useSettingsStore();

  const [isTermsVisible, setIsTermsVisible] = useState(false);

  const {
    pendingRequests,
    isSearching,
    sendFriendRequest,
    respondToRequest,
    clearAllRequests
  } = useFriendRequests();

  const [isAddFriendVisible, setIsAddFriendVisible] = useState(false);
  const [searchTag, setSearchTag] = useState("");
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const handleSend = async () => {
    setFeedback(null);
    const result: FriendRequestResult = await sendFriendRequest(searchTag);
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
        setFeedback({ type: 'info', text: 'You cannot send a friend request to yourself.' });
        break;
      case 'error':
        setFeedback({ type: 'error', text: result.message ?? 'Unknown error.' });
        break;
    }
  };

  const handleCloseAddFriend = () => {
    setIsAddFriendVisible(false);
    setSearchTag("");
    setFeedback(null);
  };

  const handleLeaveGroup = () => {
    setActiveGroupId(null);
    setGroupMembers([]);
  };

  const handleAcceptGroup = (inviteId: string, groupId: string) => {
    setActiveGroupId(groupId);
    setPendingGroupInvites(pendingGroupInvites.filter(inv => inv.id !== inviteId));
  };

  const hasMessages = pendingRequests.length > 0 || pendingGroupInvites.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft color="white" size={28} />
          <Text style={styles.backText}>BACK</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <TouchableOpacity
          style={styles.profileSection}
          onPress={() => navigation.navigate("EditProfile")}
          activeOpacity={0.7}
        >
          <View style={styles.avatarContainer}>
            <Image source={require("../assets/logo.png")} style={styles.avatar} />
            <View style={styles.addPhotoBadge}>
              <Text style={{ color: "white", fontSize: 18 }}>✎</Text>
            </View>
          </View>

          {currentUser ? (
            <View style={styles.nameContainer}>
              <Text style={styles.userName}>{currentUser.name}</Text>
              <Text style={styles.userTag}>#{currentUser.tag}</Text>
            </View>
          ) : (
            <ActivityIndicator color="#A855F7" size="small" style={{ marginTop: 5 }} />
          )}
        </TouchableOpacity>

        {activeGroupId && (
          <View style={styles.groupSection}>
            <View style={styles.groupHeader}>
              <View style={styles.messageTitleRow}>
                <Users color="#A855F7" size={20} />
                <Text style={styles.messageTitle}>CURRENT GROUP</Text>
              </View>
              <TouchableOpacity onPress={handleLeaveGroup} style={styles.leaveButton}>
                <LogOut color="#EF4444" size={20} />
              </TouchableOpacity>
            </View>

            {groupMembers.map((member) => (
              <View key={member.id} style={styles.memberCard}>
                <Text style={styles.memberText}>{member.name} {member.tag}</Text>
                <TouchableOpacity
                  onPress={() => sendFriendRequest(member.tag)}
                  style={styles.addMemberBtn}
                >
                  <UserPlus color="#A855F7" size={18} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={styles.menuList}>
          <TouchableOpacity style={styles.menuItem} onPress={() => setIsAddFriendVisible(true)}>
            <View style={styles.menuItemLeft}>
              <UserPlus color="#A855F7" size={24} />
              <Text style={styles.menuItemText}>ADD FRIEND</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate("SavedPlaces")}
          >
            <View style={styles.menuItemLeft}>
              <Bookmark color="#A855F7" size={24} />
              <Text style={styles.menuItemText}>SAVED PLACES</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate("DislikedStreets")}
          >
            <View style={styles.menuItemLeft}>
              <MapPinOff color="#A855F7" size={24} />
              <Text style={styles.menuItemText}>DISLIKED STREETS</Text>
            </View>
          </TouchableOpacity>
        </View>

        {hasMessages && (
          <View style={styles.messageSection}>
            <View style={styles.messageHeader}>
              <View style={styles.messageTitleRow}>
                <MessageSquare color="white" size={20} />
                <Text style={styles.messageTitle}>
                  MESSAGES ({pendingRequests.length + pendingGroupInvites.length})
                </Text>
              </View>
              <TouchableOpacity onPress={clearAllRequests}>
                <X color="#444" size={20} />
              </TouchableOpacity>
            </View>

            {pendingGroupInvites.map((inv) => (
              <View key={inv.id} style={[styles.notificationCard, { borderColor: '#10B981' }]}>
                <Text style={styles.notificationText}>
                  {inv.senderName} INVITED YOU TO A RIDE
                </Text>
                <View style={styles.notificationActions}>
                  <ActionButton
                    title="JOIN"
                    style={[styles.notifBtn, { backgroundColor: '#10B981' }]}
                    textStyle={{ fontSize: 12 }}
                    onPress={() => handleAcceptGroup(inv.id, inv.groupId)}
                  />
                  <ActionButton
                    title="REJECT"
                    variant="outline"
                    style={styles.notifBtn}
                    textStyle={{ fontSize: 12 }}
                    onPress={() => setPendingGroupInvites(pendingGroupInvites.filter(i => i.id !== inv.id))}
                  />
                </View>
              </View>
            ))}

            {pendingRequests.map((req) => (
              <View key={req.id} style={styles.notificationCard}>
                <Text style={styles.notificationText}>
                  {req.name} ADDED YOU AS FRIEND
                </Text>
                <View style={styles.notificationActions}>
                  <ActionButton
                    title="ACCEPT"
                    style={styles.notifBtn}
                    textStyle={{ fontSize: 12 }}
                    onPress={() => respondToRequest(req.id, 'accept')}
                  />
                  <ActionButton
                    title="REJECT"
                    variant="outline"
                    style={styles.notifBtn}
                    textStyle={{ fontSize: 12 }}
                    onPress={() => respondToRequest(req.id, 'reject')}
                  />
                </View>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity
          style={styles.termsContainer}
          onPress={() => setIsTermsVisible(true)}
        >
          <Text style={styles.termsLinkText}>Terms & Conditions</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.deleteAccountButton}
          onPress={confirmAndDelete}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <ActivityIndicator color="#EF4444" size="small" />
          ) : (
            <Text style={styles.deleteAccountText}>DELETE ACCOUNT</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={isAddFriendVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCloseAddFriend}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>SEARCH DRIVER</Text>
              <TouchableOpacity onPress={handleCloseAddFriend}>
                <X color="#444" size={24} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputContainer}>
              <Search color="#888" size={20} style={styles.inputIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Enter TAG (e.g. #4Z9C)"
                placeholderTextColor="#666"
                value={searchTag}
                onChangeText={(t) => { setSearchTag(t); setFeedback(null); }}
                autoCapitalize="characters"
                maxLength={6}
              />
            </View>

            {feedback && (
              <View style={[
                styles.feedbackRow,
                feedback.type === 'success' && styles.feedbackSuccess,
                feedback.type === 'error'   && styles.feedbackError,
                feedback.type === 'info'    && styles.feedbackInfo,
              ]}>
                {feedback.type === 'success' && <CheckCircle color="#10B981" size={16} />}
                {feedback.type === 'error'   && <AlertCircle color="#EF4444" size={16} />}
                {feedback.type === 'info'    && <Info color="#F59E0B" size={16} />}
                <Text style={[
                  styles.feedbackText,
                  feedback.type === 'success' && { color: '#10B981' },
                  feedback.type === 'error'   && { color: '#EF4444' },
                  feedback.type === 'info'    && { color: '#F59E0B' },
                ]}>{feedback.text}</Text>
              </View>
            )}

            <ActionButton
              title={isSearching ? "SEARCHING..." : "SEND REQUEST"}
              onPress={handleSend}
              style={{ marginTop: 16, width: "100%" }}
              disabled={isSearching || searchTag.length < 2}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={isTermsVisible} transparent={true} animationType="slide">
        <View style={styles.termsOverlay}>
          <View style={styles.termsContent}>
            <Text style={styles.termsTitle}>NightDrive — Terms & Conditions</Text>

            <ScrollView style={styles.termsScroll} showsVerticalScrollIndicator={true}>
              <Text style={styles.termsText}>
                <Text style={styles.termsBold}>Effective / Last Updated:</Text> March 21, 2026{"\n\n"}
                NightDrive is a community-driven navigation app for car enthusiasts, providing real-time GPS navigation, social features, and crowd-sourced road event reporting. By using the App, users agree to comply with these Terms.{"\n\n"}

                <Text style={styles.termsBold}>1. User Eligibility & Accounts</Text>{"\n"}
                • Must be ≥18 years old or legal driving age.{"\n"}
                • Valid driver’s license required if using while driving.{"\n"}
                • Account creation requires email, username, password, and generates a unique driver tag (e.g., #4Z9C).{"\n"}
                • Users are responsible for account security. Account deletion permanently removes data and friend connections.{"\n\n"}

                <Text style={styles.termsBold}>2. Acceptable Use</Text>{"\n"}
                Users must:{"\n"}
                • Follow traffic laws and report accurate road events.{"\n"}
                • Treat other users respectfully.{"\n\n"}
                Prohibited activities:{"\n"}
                • Unsafe interaction while driving.{"\n"}
                • False reports or vote manipulation.{"\n"}
                • Unauthorized access, impersonation, or automated scraping.{"\n\n"}

                <Text style={styles.termsBold}>3. Driving Safety Disclaimer</Text>{"\n"}
                NightDrive is informational only; the driver is always responsible. GPS, dead reckoning, and community reports may contain errors. Do not use App features as a substitute for vehicle instruments. NightDrive and affiliates are not liable for accidents, fines, or damages.{"\n\n"}

                <Text style={styles.termsBold}>4. Community Content</Text>{"\n"}
                Users are responsible for accuracy and legality of reports. Event upvote/downvote system helps validate content but is not guaranteed. NightDrive may remove content violating Terms.{"\n\n"}

                <Text style={styles.termsBold}>5. Intellectual Property & Licensing</Text>{"\n"}
                App code, design, logos, and brand are owned by NightDrive. Limited, personal-use license granted to users. Third-party services (Google Maps, PostGIS) are subject to their own terms.{"\n\n"}

                <Text style={styles.termsBold}>6. Privacy & Data</Text>{"\n"}
                • <Text style={styles.termsBold}>Collected Data:</Text> Account, GPS location, usage data, device info.{"\n"}
                • <Text style={styles.termsBold}>Security:</Text> Passwords hashed via bcrypt, API calls secured with JWT tokens, encrypted transmission.{"\n"}
                • <Text style={styles.termsBold}>Sharing:</Text> Only with law enforcement or essential service providers.{"\n"}
                • <Text style={styles.termsBold}>User Rights:</Text> Access, correct, delete, export data; withdraw consent anytime.{"\n\n"}

                <Text style={styles.termsBold}>7. Liability & Indemnification</Text>{"\n"}
                App is provided “as is”; no warranties. NightDrive not liable for indirect, incidental, or consequential damages.{"\n\n"}

                <Text style={styles.termsBold}>8. Termination</Text>{"\n"}
                Users can delete accounts anytime. NightDrive may suspend accounts for violations.{"\n\n"}

                <Text style={styles.termsBold}>9. Modifications & Governing Law</Text>{"\n"}
                Terms may be updated; continued use = acceptance. Governed by Romanian law, jurisdiction of Bucharest courts.{"\n\n"}

                <Text style={styles.termsBold}>10. Contact</Text>{"\n"}
                Email: mihai.arisanu2006@gmail.com
              </Text>
            </ScrollView>

            <TouchableOpacity style={styles.closeTermsBtn} onPress={() => setIsTermsVisible(false)}>
              <Text style={styles.closeTermsBtnText}>I UNDERSTAND & AGREE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 10,
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
  profileSection: {
    alignItems: "center",
    marginVertical: 30,
  },
  avatarContainer: {
    position: "relative",
    marginBottom: 15,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: "#A855F7",
    backgroundColor: "#111",
  },
  addPhotoBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: "#A855F7",
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#000",
  },
  nameContainer: {
    alignItems: "center",
    gap: 2,
  },
  userName: {
    color: "white",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 1,
  },
  userTag: {
    color: "white",
    fontSize: 14,
    fontWeight: "bold",
    opacity: 0.8,
  },
  groupSection: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  groupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  leaveButton: {
    padding: 5,
  },
  memberCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#0A0A0A",
    padding: 15,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#1A1A1A",
  },
  memberText: {
    color: "white",
    fontWeight: "bold",
  },
  addMemberBtn: {
    padding: 5,
  },
  menuList: {
    paddingHorizontal: 20,
    gap: 15,
  },
  menuItem: {
    backgroundColor: "#0A0A0A",
    padding: 20,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#1A1A1A",
  },
  menuItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
  },
  menuItemText: {
    color: "white",
    fontSize: 14,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  messageSection: {
    marginTop: 40,
    paddingHorizontal: 20,
  },
  messageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 15,
  },
  messageTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  messageTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "900",
  },
  notificationCard: {
    backgroundColor: "#111",
    padding: 20,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#A855F7",
    marginBottom: 10,
  },
  notificationText: {
    color: "white",
    fontSize: 14,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 15,
  },
  notificationActions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 15,
  },
  notifBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    minWidth: 100,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#111",
    width: "100%",
    padding: 25,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#A855F7",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 1,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0A0A0A",
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 12,
    paddingHorizontal: 15,
  },
  inputIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: "white",
    fontSize: 16,
    paddingVertical: 15,
    fontWeight: "bold",
  },
  feedbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
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
  deleteAccountButton: {
    marginTop: 40,
    marginBottom: 20,
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: "#EF4444",
    borderRadius: 10,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
  },
  deleteAccountText: {
    color: "#EF4444",
    fontSize: 14,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  termsContainer: {
    marginTop: 30,
    alignItems: "center",
  },
  termsLinkText: {
    color: "#666",
    fontSize: 12,
    fontWeight: "bold",
    textDecorationLine: "underline",
  },
  termsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  termsContent: {
    width: '100%',
    maxHeight: '80%',
    backgroundColor: '#111',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#333'
  },
  termsTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 15,
    textAlign: 'center',
    letterSpacing: 1
  },
  termsScroll: {
    marginBottom: 20
  },
  termsText: {
    color: '#AAA',
    fontSize: 14,
    lineHeight: 22
  },
  termsBold: {
    color: '#A855F7',
    fontWeight: 'bold'
  },
  closeTermsBtn: {
    backgroundColor: '#A855F7',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center'
  },
  closeTermsBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 1
  }
});