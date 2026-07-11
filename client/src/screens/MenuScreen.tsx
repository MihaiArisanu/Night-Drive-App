import { ArrowLeft, Bookmark, MapPinOff, MessageSquare, Search, UserPlus, X, Users, LogOut, CheckCircle, AlertCircle, Info } from "lucide-react-native";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Modal, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useState } from "react";
import { useFocusEffect } from '@react-navigation/native';
import { ActionButton } from "../components/ActionButton";
import { ProfileAvatar } from '../components/ProfileAvatar';

import { useDeleteAccount } from "../hooks/useDeleteAccount";
import { useFriendRequests, FriendRequestResult } from "../hooks/useFriendRequests";
import { useSettingsStore } from '../store/useSettingsStore';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { apiFetch } from '../services/api';

export default function MenuScreen({ navigation }: any) {
  const { currentUser, refetchUser } = useCurrentUser();
  const { confirmAndDelete, isDeleting } = useDeleteAccount();
  const {
    activeGroupId, setActiveGroupId,
    setGroupMembers
  } = useSettingsStore();

  const [isTermsVisible, setIsTermsVisible] = useState(false);

  useFocusEffect(useCallback(() => {
    refetchUser();
  }, [refetchUser]));

  const {
    isSearching,
    sendFriendRequest
  } = useFriendRequests();

  const [isAddFriendVisible, setIsAddFriendVisible] = useState(false);
  const [searchTag, setSearchTag] = useState("");
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const [isAppFeedbackVisible, setIsAppFeedbackVisible] = useState(false);
  const [appFeedbackText, setAppFeedbackText] = useState("");
  const [isSendingAppFeedback, setIsSendingAppFeedback] = useState(false);
  const [appFeedbackStatus, setAppFeedbackStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSendAppFeedback = async () => {
    if (!appFeedbackText.trim()) return;
    setAppFeedbackStatus(null);
    setIsSendingAppFeedback(true);
    try {
      await apiFetch('/users/feedback', {
        method: 'POST',
        body: JSON.stringify({ message: appFeedbackText.trim() })
      });
      setAppFeedbackStatus({ type: 'success', text: 'Feedback sent successfully! Thank you.' });
      setTimeout(() => {
        setIsAppFeedbackVisible(false);
        setAppFeedbackText('');
        setAppFeedbackStatus(null);
      }, 2000);
    } catch (error: any) {
      setAppFeedbackStatus({ type: 'error', text: error.message || 'Failed to send feedback.' });
    } finally {
      setIsSendingAppFeedback(false);
    }
  };

  const handleSend = async () => {
    setFeedback(null);
    const result: FriendRequestResult = await sendFriendRequest(searchTag);
    switch (result.status) {
      case 'success':
        setFeedback({ type: 'success', text: `Request sent to ${result.name}! ✓` });
        setSearchTag("");
        break;
      case 'friendship_repaired':
        setFeedback({ type: 'success', text: `Friendship with ${result.name} restored! ✓` });
        setSearchTag("");
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.navigate("Main")} style={styles.backButton}>
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
            <ProfileAvatar
              profilePictureUrl={currentUser?.profile_picture_url}
              size={100}
              style={styles.avatar}
            />
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

        {!!activeGroupId && (
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
          </View>
        )}

        <View style={styles.menuList}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate('Friends')}
          >
            <View style={styles.menuItemLeft}>
              <UserPlus color="#A855F7" size={24} />
              <Text style={styles.menuItemText}>Friends</Text>
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

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setIsAppFeedbackVisible(true);
              setAppFeedbackStatus(null);
              setAppFeedbackText("");
            }}
          >
            <View style={styles.menuItemLeft}>
              <MessageSquare color="#A855F7" size={24} />
              <Text style={styles.menuItemText}>SEND FEEDBACK</Text>
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.termsContainer}
          onPress={() => setIsTermsVisible(true)}
        >
          <Text style={styles.termsLinkText}>Terms & Conditions</Text>
        </TouchableOpacity>

        <View style={styles.accountActionsContainer}>
          <TouchableOpacity
            style={styles.signOutButton}
            onPress={() => navigation.navigate("Auth")}
          >
            <LogOut color="white" size={16} style={{ marginRight: 8 }} />
            <Text style={styles.signOutText}>SIGN OUT</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={confirmAndDelete}
            disabled={isDeleting}
            style={styles.deleteSmallButton}
          >
            {isDeleting ? (
              <ActivityIndicator color="#EF4444" size="small" />
            ) : (
              <Text style={styles.deleteSmallText}>delete account</Text>
            )}
          </TouchableOpacity>
        </View>
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

            <ActionButton
              title={isSearching ? "SEARCHING..." : "SEND REQUEST"}
              onPress={handleSend}
              style={{ marginTop: 16, width: "100%" }}
              disabled={isSearching || searchTag.length < 2}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={isAppFeedbackVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsAppFeedbackVisible(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>SEND FEEDBACK</Text>
              <TouchableOpacity onPress={() => setIsAppFeedbackVisible(false)}>
                <X color="#444" size={24} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={{ height: 100, width: '100%', textAlignVertical: 'top', padding: 15, backgroundColor: '#0A0A0A', borderWidth: 1, borderColor: '#333', borderRadius: 12, color: 'white', fontSize: 16 }}
              placeholder="Tell us what you think or report a bug"
              placeholderTextColor="#666"
              value={appFeedbackText}
              onChangeText={(t) => { setAppFeedbackText(t); setAppFeedbackStatus(null); }}
              multiline
            />

            {appFeedbackStatus && (
              <View style={[
                styles.feedbackRow,
                appFeedbackStatus.type === 'success' && styles.feedbackSuccess,
                appFeedbackStatus.type === 'error' && styles.feedbackError,
              ]}>
                {appFeedbackStatus.type === 'success' && <CheckCircle color="#10B981" size={16} />}
                {appFeedbackStatus.type === 'error' && <AlertCircle color="#EF4444" size={16} />}
                <Text style={[
                  styles.feedbackText,
                  appFeedbackStatus.type === 'success' && { color: '#10B981' },
                  appFeedbackStatus.type === 'error' && { color: '#EF4444' },
                ]}>{appFeedbackStatus.text}</Text>
              </View>
            )}

            <ActionButton
              title={isSendingAppFeedback ? "SENDING..." : "SEND"}
              onPress={handleSendAppFeedback}
              style={{ marginTop: 16, width: "100%" }}
              disabled={isSendingAppFeedback || appFeedbackText.trim().length < 5}
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
  accountActionsContainer: {
    marginTop: 40,
    marginBottom: 20,
    alignSelf: "center",
    alignItems: "center",
    gap: 10,
  },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: "#555",
    borderRadius: 10,
    backgroundColor: "#1A1A1A",
  },
  signOutText: {
    color: "white",
    fontSize: 14,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  deleteSmallButton: {
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  deleteSmallText: {
    color: "#EF4444",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    textDecorationLine: "underline",
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
