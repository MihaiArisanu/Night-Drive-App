import { ArrowLeft, Bookmark, MapPinOff, MessageSquare, Search, UserPlus, X, Users, LogOut } from "lucide-react-native";
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Modal, KeyboardAvoidingView, Platform, ActivityIndicator, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState } from "react";
import { ActionButton } from "../components/ActionButton";

import { useDeleteAccount } from "../hooks/useDeleteAccount";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useFriendRequests } from "../hooks/useFriendRequests";
import { useSettingsStore } from '../store/useSettingsStore';

export default function MenuScreen({ navigation }: any) {
  const { currentUser } = useCurrentUser();
  const { confirmAndDelete, isDeleting } = useDeleteAccount();
  const {
    activeGroupId, setActiveGroupId,
    groupMembers, setGroupMembers,
    pendingGroupInvites, setPendingGroupInvites
  } = useSettingsStore();

  const {
    pendingRequests,
    isSearching,
    sendFriendRequest,
    respondToRequest,
    clearAllRequests
  } = useFriendRequests();

  const [isAddFriendVisible, setIsAddFriendVisible] = useState(false);
  const [searchTag, setSearchTag] = useState("");

  const handleSend = () => {
    sendFriendRequest(searchTag, () => {
      setIsAddFriendVisible(false);
      setSearchTag("");
    });
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
            <Text style={styles.userName}>
              {currentUser.name} {currentUser.tag}
            </Text>
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
                  onPress={() => sendFriendRequest(member.tag, () => { })}
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

          <TouchableOpacity style={styles.menuItem}>
            <View style={styles.menuItemLeft}>
              <Bookmark color="#A855F7" size={24} />
              <Text style={styles.menuItemText}>SAVED PLACES</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem}>
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
          onPress={() => Linking.openURL('https://www.youtube.com/watch?v=FjR2kJTbslQ')}
        >
          <Text style={styles.termsText}>Terms and Conditions & Privacy Policy</Text>
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
        onRequestClose={() => setIsAddFriendVisible(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>SEARCH DRIVER</Text>
              <TouchableOpacity onPress={() => setIsAddFriendVisible(false)}>
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
                onChangeText={setSearchTag}
                autoCapitalize="characters"
                maxLength={6}
              />
            </View>

            <ActionButton
              title={isSearching ? "SEARCHING..." : "SEND REQUEST"}
              onPress={handleSend}
              style={{ marginTop: 20, width: "100%" }}
              disabled={isSearching || searchTag.length < 2}
            />
          </View>
        </KeyboardAvoidingView>
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

  userName: {
    color: "white",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 1,
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

  termsText: {
    color: "#666",
    fontSize: 12,
    fontWeight: "bold",
    textDecorationLine: "underline",
  },
});