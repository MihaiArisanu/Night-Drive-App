import { ArrowLeft, Ghost, MapPinOff, MessageSquare, UserPlus, X } from "lucide-react-native";
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ActionButton } from "../components/ActionButton";
import { useSettings } from "../context/SettingsContext";

export default function MenuScreen({ navigation }: any) {
  const { isTrainActive, setIsTrainActive } = useSettings();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()} 
          style={styles.backButton}
        >
          <ArrowLeft color="white" size={28} />
          <Text style={styles.backText}>BACK</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            <Image
              source={require("../assets/logo.png")}
              style={styles.avatar}
            />
            <TouchableOpacity style={styles.addPhotoBadge}>
              <Text style={{ color: "white", fontSize: 18 }}>+</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.userName}>ALEX #4Z9C</Text>
        </View>

        <View style={styles.menuList}>
          <TouchableOpacity style={styles.menuItem}>
            <View style={styles.menuItemLeft}>
              <UserPlus color="#A855F7" size={24} />
              <Text style={styles.menuItemText}>FRIENDS</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.menuItem,
              isTrainActive && { borderColor: "#A855F7" },
            ]}
            onPress={() => setIsTrainActive(!isTrainActive)}
          >
            <View style={styles.menuItemLeft}>
              <Ghost color={isTrainActive ? "#A855F7" : "#444"} size={24} />
              <Text
                style={[
                  styles.menuItemText,
                  !isTrainActive && { color: "#444" },
                ]}
              >
                TRAIN YOUR COPILOT {isTrainActive ? "(ON)" : "(OFF)"}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem}>
            <View style={styles.menuItemLeft}>
              <MapPinOff color="#A855F7" size={24} />
              <Text style={styles.menuItemText}>DISLIKED STREETS</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.messageSection}>
          <View style={styles.messageHeader}>
            <View style={styles.messageTitleRow}>
              <MessageSquare color="white" size={20} />
              <Text style={styles.messageTitle}>MESSAGE (1)</Text>
            </View>
            <TouchableOpacity>
              <X color="#444" size={20} />
            </TouchableOpacity>
          </View>

          <View style={styles.notificationCard}>
            <Text style={styles.notificationText}>
              JOHNNY ADDED YOU AS FRIEND
            </Text>
            <View style={styles.notificationActions}>
              <ActionButton
                title="ACCEPT"
                style={styles.notifBtn}
                textStyle={{ fontSize: 12 }}
              />
              <ActionButton
                title="REJECT"
                variant="outline"
                style={styles.notifBtn}
                textStyle={{ fontSize: 12 }}
              />
            </View>
          </View>
        </View>
      </ScrollView>
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
  userRole: {
    color: "#444",
    fontSize: 12,
    fontWeight: "bold",
    marginTop: 5,
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
});