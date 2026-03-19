import React, { createContext, useContext, useState } from "react";

interface SettingsContextType {
  isDNDActive: boolean;
  setIsDNDActive: (value: boolean) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [isDNDActive, setIsDNDActive] = useState(false);

  return (
    <SettingsContext.Provider value={{ isDNDActive, setIsDNDActive }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context)
    throw new Error("useSettings must be used within a SettingsProvider");
  return context;
};