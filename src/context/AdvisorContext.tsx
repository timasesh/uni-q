import { createContext, useContext, useState, type ReactNode } from "react";

type Ctx = {
  advisorId: number | null;
  setAdvisorId: (id: number | null) => void;
};

const AdvisorContext = createContext<Ctx | null>(null);

export function AdvisorProvider({ children }: { children: ReactNode }) {
  const [advisorId, setAdvisorId] = useState<number | null>(null);
  return <AdvisorContext.Provider value={{ advisorId, setAdvisorId }}>{children}</AdvisorContext.Provider>;
}

export function useAdvisorContext() {
  const v = useContext(AdvisorContext);
  if (!v) throw new Error("useAdvisorContext must be used within AdvisorProvider");
  return v;
}
