import { redirect } from "next/navigation";

/** A página inicial do ambiente é o "Hoje". */
export default function Home() {
  redirect("/hoje");
}
