import Image from "next/image";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { UserButton, Show, SignIn, SignInButton } from "@clerk/nextjs";

export default function Home() {
  return (
    <div>
      <div>Hello ji!</div>
      <ModeToggle />
      <Show when="signed-out">
        <SignInButton />
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </div>
  );
}
