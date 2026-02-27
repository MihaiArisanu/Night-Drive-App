import React, { createContext, useContext, useState } from "react";

interface SettingsContextType {
  isTrainActive: boolean;
  setIsTrainActive: (value: boolean) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined,
);

export const SettingsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [isTrainActive, setIsTrainActive] = useState(false);

  return (
    <SettingsContext.Provider value={{ isTrainActive, setIsTrainActive }}>
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