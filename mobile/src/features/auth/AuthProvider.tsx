import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type PropsWithChildren
} from "react";
import { AppState, Platform } from "react-native";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/shared/supabase/client";

export type AuthStatus = "loading" | "unconfigured" | "signed_out" | "signed_in" | "error";
type AuthState = {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  errorMessage: string | null;
};
type AuthContextValue = AuthState & {
  isConfigured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);
const INITIAL_STATE: AuthState = {
  status: isSupabaseConfigured ? "loading" : "unconfigured",
  session: null,
  user: null,
  errorMessage: null
};

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>(INITIAL_STATE);

  useEffect(() => {
    if (!supabase) {
      setState({ status: "unconfigured", session: null, user: null, errorMessage: null });
      return;
    }

    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setState({
        status: session ? "signed_in" : "signed_out",
        session,
        user: session?.user ?? null,
        errorMessage: null
      });
    });

    void supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          setState({
            status: "error", session: null, user: null,
            errorMessage: "Non è stato possibile ripristinare la sessione. Controlli la connessione e riprovi."
          });
          return;
        }
        setState({
          status: data.session ? "signed_in" : "signed_out",
          session: data.session,
          user: data.session?.user ?? null,
          errorMessage: null
        });
      })
      .catch(() => {
        if (!mounted) return;
        setState({
          status: "error", session: null, user: null,
          errorMessage: "Non è stato possibile leggere la sessione protetta. Effettui nuovamente l'accesso."
        });
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || Platform.OS === "web") return;
    const updateAutoRefresh = (appState: string) => {
      if (appState === "active") supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    };
    updateAutoRefresh(AppState.currentState ?? "active");
    const subscription = AppState.addEventListener("change", updateAutoRefresh);
    return () => {
      subscription.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error("Configurazione Supabase non presente.");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) throw new Error("Configurazione Supabase non presente.");
    // Sign out only this device; preserve the user's other sessions.
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, isConfigured: isSupabaseConfigured, signIn, signOut }),
    [state, signIn, signOut]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth deve essere usato dentro AuthProvider.");
  return context;
}
