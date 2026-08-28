import { HomePage } from "../components/home/HomePage";
import type { AuthResponse } from "../types";

type LoginProps = {
  auth: AuthResponse | null;
  error?: string | null;
  onLoginDiscord: () => void;
  onVerify: () => void;
  verifying: boolean;
};

export function Login(props: LoginProps) {
  return <HomePage {...props} />;
}
