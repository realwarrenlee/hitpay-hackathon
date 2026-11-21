"use client";
import { createContext, useContext } from "react";

const LedgerAccess = createContext(false);
export function LedgerAccessProvider({
  value,
  children,
}: {
  value: boolean;
  children: React.ReactNode;
}) {
  return (
    <LedgerAccess.Provider value={value}>{children}</LedgerAccess.Provider>
  );
}
export function useLedgerAccess() {
  return useContext(LedgerAccess);
}
