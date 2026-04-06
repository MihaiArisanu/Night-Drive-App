import { useNavigation } from "@react-navigation/native";
import { Menu, Moon, Zap } from "lucide-react-native";
import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { useSettingsStore } from '../store/useSettingsStore';
import { IconButton } from "./IconButton";

interface TopBarProps {
  onZenPress?: () => void;
  isZenActive?: boolean;
}

export const TopBar = ({ onZenPress, isZenActive }: TopBarProps) => {
  const navigation = useNavigation<any>();
  const { isDNDActive, setIsDNDActive } = useSettingsStore();

  return (
    <View style={styles.topBar}>
      <IconButton
        icon={<Menu color="white" size={28} />}
        onPress={() => navigation.navigate("Menu")}
      />

      <View style={{ flex: 1 }} />

      <View style={styles.topRightActions}>
        <TouchableOpacity
          onPress={onZenPress}
          style={[
            styles.actionWrapper,
            isZenActive && styles.activeGlowGreen,
          ]}
        >
          <Zap
            color={isZenActive ? "#10B981" : "white"}
            size={24}
            fill={isZenActive ? "#10B981" : "none"}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setIsDNDActive(!isDNDActive)}
          style={[styles.actionWrapper, isDNDActive && styles.activeGlowBlue]}
        >
          <Moon
            color={isDNDActive ? "#60A5FA" : "white"}
            size={24}
            fill={isDNDActive ? "#60A5FA" : "none"}
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
  activeGlowGreen: {
    shadowColor: "#10B981",
    shadowOpacity: 0.6,
    shadowRadius: 10,
    backgroundColor: "rgba(16, 185, 129, 0.1)",
  },
});