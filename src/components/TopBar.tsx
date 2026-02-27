import { useNavigation } from "@react-navigation/native";
import { Menu, Moon, Zap } from "lucide-react-native";
import React, { useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { useSettings } from "../context/SettingsContext";
import { IconButton } from "./IconButton";

export const TopBar = () => {
  const navigation = useNavigation<any>();
  const { isTrainActive } = useSettings();
  const [isFastestRoute, setIsFastestRoute] = useState(false);
  const [isDND, setIsDND] = useState(false);

  return (
    <View style={styles.topBar}>
      <IconButton
        icon={<Menu color="white" size={28} />}
        onPress={() => navigation.navigate("Menu")}
      />

      <View style={styles.trackingIndicator}>
        {isTrainActive && <View style={styles.greenDot} />}
      </View>

      <View style={styles.topRightActions}>
        <TouchableOpacity
          onPress={() => setIsFastestRoute(!isFastestRoute)}
          style={[
            styles.actionWrapper,
            isFastestRoute && styles.activeGlowPurple,
          ]}
        >
          <Zap
            color={isFastestRoute ? "#A855F7" : "white"}
            size={24}
            fill={isFastestRoute ? "#A855F7" : "none"}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setIsDND(!isDND)}
          style={[styles.actionWrapper, isDND && styles.activeGlowBlue]}
        >
          <Moon
            color={isDND ? "#60A5FA" : "white"}
            size={24}
            fill={isDND ? "#60A5FA" : "none"}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    height: 60,
  },
  trackingIndicator: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  greenDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#22C55E",
    shadowColor: "#22C55E",
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 5,
  },
  topRightActions: { flexDirection: "row", gap: 15 },
  actionWrapper: {
    padding: 8,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  activeGlowPurple: {
    shadowColor: "#A855F7",
    shadowOpacity: 0.6,
    shadowRadius: 10,
    backgroundColor: "rgba(168, 85, 247, 0.1)",
  },
  activeGlowBlue: {
    shadowColor: "#60A5FA",
    shadowOpacity: 0.6,
    shadowRadius: 10,
    backgroundColor: "rgba(96, 165, 250, 0.1)",
  },
});