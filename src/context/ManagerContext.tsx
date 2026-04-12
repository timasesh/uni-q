import { createContext, useContext, useState, type ReactNode } from "react";

type Ctx = {
  managerId: number | null;
  setManagerId: (id: number | null) => void;
};

const ManagerContext = createContext<Ctx | null>(null);

export function ManagerProvider({ children }: { children: ReactNode }) {
  const [managerId, setManagerId] = useState<number | null>(null);
  return <ManagerContext.Provider value={{ managerId, setManagerId }}>{children}</ManagerContext.Provider>;
}

export function useManagerContext() {
  const v = useContext(ManagerContext);
  if (!v) throw new Error("useManagerContext must be used within ManagerProvider");
  return v;
}
