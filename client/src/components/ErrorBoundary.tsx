import React, { Component, ErrorInfo, ReactNode } from "react";
import { View, Text, StyleSheet } from "react-native";
import { AlertTriangle } from "lucide-react-native";
import { recordNonFatalError } from "../services/crashReporting";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    recordNonFatalError(error, "react_error_boundary", {
      has_component_stack: Boolean(errorInfo.componentStack),
    }).catch(() => undefined);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <AlertTriangle color="#EF4444" size={48} />
          <Text style={styles.title}>Map Render Error</Text>
          <Text style={styles.subtitle}>A component failed to load. The app is still running, but this feature is temporarily unavailable.</Text>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#121212',
  },
  title: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 15,
  },
  subtitle: {
    color: '#9CA3AF',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
  }
});
