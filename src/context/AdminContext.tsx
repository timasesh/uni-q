import { createContext, useContext, useState, type ReactNode } from "react";

export type AdminUser = { id: number; login: string; name: string };

type Ctx = {
  adminUser: AdminUser | null | undefined;
  setAdminUser: (u: AdminUser | null | undefined) => void;
};

const AdminContext = createContext<Ctx | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const [adminUser, setAdminUser] = useState<AdminUser | null | undefined>(undefined);
  return <AdminContext.Provider value={{ adminUser, setAdminUser }}>{children}</AdminContext.Provider>;
}

export function useAdminContext() {
  const v = useContext(AdminContext);
  if (!v) throw new Error("useAdminContext must be used within AdminProvider");
  return v;
}
