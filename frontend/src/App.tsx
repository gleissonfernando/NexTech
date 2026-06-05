import { Loader2 } from "lucide-react";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { useAuth } from "./hooks/useAuth";

export function App() {
  const { auth, error, loading, loginDevelopment, loginDiscord, logout } = useAuth();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    );
  }

  if (!auth) {
    return <Login error={error} onLoginDevelopment={loginDevelopment} onLoginDiscord={loginDiscord} />;
  }

  return <Dashboard auth={auth} onLogout={logout} />;
}
