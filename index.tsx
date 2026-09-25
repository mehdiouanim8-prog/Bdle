import React, { useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { api, del, put } from "../../src/api";
import { clearToken, getToken } from "../../src/session";
import { Button, Field, styles, C } from "../../src/ui";

const WEB = process.env.EXPO_PUBLIC_PUBLIC_WEB_URL || "https://bundle.example.com";

function Row({ title, subtitle, onPress }: any) {
  return <Pressable onPress={onPress} style={{ paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.line }}><Text style={{ color: C.text, fontWeight: "800", fontSize: 16 }}>{title}</Text><Text style={{ color: C.muted, marginTop: 5, lineHeight: 19 }}>{subtitle}</Text></Pressable>;
}
function Bool({ label, value, onChange }: any) {
  return <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 }}><Text style={{ color: C.text, flex: 1 }}>{label}</Text><Switch value={value} onValueChange={onChange} />
  </View>;
}

export default function Settings() {
  const [data, setData] = useState<any>(null);
  const [prefs, setPrefs] = useState<any>({ minAge: 18, maxAge: 99, maxDistanceKm: 50, genderPreference: "", relationshipIntent: "", interests: [] });
  const [notifications, setNotifications] = useState<any>({ pushMessages: true, pushMatches: true, pushLikes: true, pushVerification: true, pushMembership: true, pushSafety: true, emailAccount: true, emailMarketing: false });
  const [sessions, setSessions] = useState<any[]>([]);
  const [blocked, setBlocked] = useState<any[]>([]);
  const [pw, setPw] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const t = await getToken();
      const [me, pr, np, se, bl] = await Promise.all([
        api("/me", {}, t || undefined), api("/preferences", {}, t || undefined), api("/notification-preferences", {}, t || undefined),
        api("/security/sessions", {}, t || undefined), api("/blocks", {}, t || undefined),
      ]);
      setData(me); setPrefs(pr); setNotifications(np); setSessions(se); setBlocked(bl);
    } catch (e: any) { setMessage(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function savePrefs() {
    try { const t = await getToken(); await put("/preferences", { ...prefs, minAge: Number(prefs.minAge), maxAge: Number(prefs.maxAge), maxDistanceKm: Number(prefs.maxDistanceKm) }, t || undefined); setMessage("Dating preferences saved."); }
    catch (e: any) { setMessage(e.message); }
  }
  async function saveNotifications() {
    try { const t = await getToken(); await put("/notification-preferences", notifications, t || undefined); setMessage("Notification preferences saved."); }
    catch (e: any) { setMessage(e.message); }
  }
  async function exportData() {
    try { const t = await getToken(); await api("/privacy/export", {}, t || undefined); setMessage("Your data export was generated for this session. A production export download service can be connected to your preferred secure storage."); }
    catch (e: any) { setMessage(e.message); }
  }
  async function revokeSession(id: string) {
    try { const t = await getToken(); await del(`/security/sessions/${id}`, t || undefined); setSessions(v => v.filter(s => s.id !== id)); }
    catch (e: any) { setMessage(e.message); }
  }
  async function unblock(userId: string) {
    try { const t = await getToken(); await del(`/blocks/${userId}`, t || undefined); setBlocked(v => v.filter(x => x.blockedId !== userId)); }
    catch (e: any) { setMessage(e.message); }
  }
  async function deleteAccount() {
    if (!pw) { setMessage("Enter your password to confirm deletion."); return; }
    Alert.alert("Delete your Bundle account", "This permanently removes your account and associated user-generated content. Cancel store billing separately to prevent renewal.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete permanently", style: "destructive", onPress: async () => {
        try { const t = await getToken(); await del("/account", t || undefined, { password: pw }); await clearToken(); router.replace("/"); }
        catch (e: any) { setMessage(e.message); }
      } },
    ]);
  }

  if (!data) return <View style={[styles.center, { backgroundColor: C.bg }]}><Text style={{ color: C.muted }}>Loading settings…</Text></View>;
  return <ScrollView contentContainerStyle={styles.scroll}>
    <Text style={styles.brand}>SETTINGS</Text>
    <Text style={styles.title}>Your Bundle controls.</Text>
    <Text style={styles.subtitle}>Privacy, security, verification, discovery, membership and account controls.</Text>

    <View style={styles.card}>
      <Text style={{ color: C.accent, fontWeight: "900", letterSpacing: 1 }}>ACCOUNT</Text>
      <Row title="Email address" subtitle={data.email} onPress={() => router.push("/change-email")} />
      {Platform.OS !== "web" ? <Row title="Phone number" subtitle={data.phoneNumber || "Not verified"} onPress={() => router.push("/change-phone")} /> : null}
      <Row title="Change password" subtitle="Update the password used to secure your account." onPress={() => router.push("/change-password")} />
    </View>

    <View style={styles.card}>
      <Text style={{ color: C.accent, fontWeight: "900", letterSpacing: 1 }}>VERIFICATION</Text>
      <Row title="Verification status" subtitle={Platform.OS === "web" ? `Email ${data.emailStatus} · Identity ${data.kyc?.status || "NOT_STARTED"} · Photos ${data.photoVerification?.status || "NOT_STARTED"}` : `Email ${data.emailStatus} · Phone ${data.phoneStatus} · Identity ${data.kyc?.status || "NOT_STARTED"} · Photos ${data.photoVerification?.status || "NOT_STARTED"}`} onPress={() => router.replace("/onboarding")} />
      <Row title="Profile review" subtitle={data.profile?.reviewStatus || "NOT_SUBMITTED"} onPress={() => router.push("/review")} />
    </View>

    <View style={styles.card}>
      <Text style={{ color: C.accent, fontWeight: "900", letterSpacing: 1 }}>DATING PREFERENCES</Text>
      <Field label="Minimum age" value={String(prefs.minAge)} onChangeText={(v: string) => setPrefs({ ...prefs, minAge: v })} keyboardType="number-pad" />
      <Field label="Maximum age" value={String(prefs.maxAge)} onChangeText={(v: string) => setPrefs({ ...prefs, maxAge: v })} keyboardType="number-pad" />
      <Field label="Maximum distance (km)" value={String(prefs.maxDistanceKm)} onChangeText={(v: string) => setPrefs({ ...prefs, maxDistanceKm: v })} keyboardType="number-pad" />
      <Field label="Gender preference" value={prefs.genderPreference || ""} onChangeText={(v: string) => setPrefs({ ...prefs, genderPreference: v })} placeholder="Optional" />
      <Field label="Relationship intention" value={prefs.relationshipIntent || ""} onChangeText={(v: string) => setPrefs({ ...prefs, relationshipIntent: v })} placeholder="Optional" />
      <Button title="Save dating preferences" onPress={savePrefs} />
    </View>

    <View style={styles.card}>
      <Text style={{ color: C.accent, fontWeight: "900", letterSpacing: 1 }}>NOTIFICATIONS</Text>
      <Bool label="New messages" value={!!notifications.pushMessages} onChange={(v: boolean) => setNotifications({ ...notifications, pushMessages: v })} />
      <Bool label="New matches" value={!!notifications.pushMatches} onChange={(v: boolean) => setNotifications({ ...notifications, pushMatches: v })} />
      <Bool label="New likes" value={!!notifications.pushLikes} onChange={(v: boolean) => setNotifications({ ...notifications, pushLikes: v })} />
      <Bool label="Verification updates" value={!!notifications.pushVerification} onChange={(v: boolean) => setNotifications({ ...notifications, pushVerification: v })} />
      <Bool label="Membership updates" value={!!notifications.pushMembership} onChange={(v: boolean) => setNotifications({ ...notifications, pushMembership: v })} />
      <Bool label="Safety alerts" value={!!notifications.pushSafety} onChange={(v: boolean) => setNotifications({ ...notifications, pushSafety: v })} />
      <Bool label="Account email" value={!!notifications.emailAccount} onChange={(v: boolean) => setNotifications({ ...notifications, emailAccount: v })} />
      <Bool label="Marketing email" value={!!notifications.emailMarketing} onChange={(v: boolean) => setNotifications({ ...notifications, emailMarketing: v })} />
      <Button title="Save notification settings" onPress={saveNotifications} />
    </View>

    <View style={styles.card}>
      <Text style={{ color: C.accent, fontWeight: "900", letterSpacing: 1 }}>PRIVACY</Text>
      <Row title="Export my data" subtitle="Request a copy of the personal information associated with your account." onPress={exportData} />
      <Row title="Privacy policy" subtitle="How Bundle handles account, profile, verification and safety information." onPress={() => Linking.openURL(`${WEB}/privacy.html`)} />
      <Row title="Terms" subtitle="Bundle terms of use and membership conditions." onPress={() => Linking.openURL(`${WEB}/terms.html`)} />
      <Row title="Community guidelines" subtitle="The rules for profiles, messages and member behavior." onPress={() => Linking.openURL(`${WEB}/community-guidelines.html`)} />
    </View>

    <View style={styles.card}>
      <Text style={{ color: C.accent, fontWeight: "900", letterSpacing: 1 }}>SAFETY</Text>
      <Row title="Blocked users" subtitle={`${blocked.length} currently blocked`} onPress={() => blocked.length ? Alert.alert("Blocked users", blocked.map(x => `${x.blocked?.profile?.firstName || "Member"} — ${x.blockedId}`).join("\n\n"), blocked.map(x => ({ text: `Unblock ${x.blocked?.profile?.firstName || "member"}`, onPress: () => unblock(x.blockedId) })).concat([{ text: "Close", style: "cancel" }])) : Alert.alert("Blocked users", "You have no blocked users.")} />
      <Row title="Safety center" subtitle="Report, block, unmatch and contact Bundle support." onPress={() => Linking.openURL(`${WEB}/safety.html`)} />
    </View>

    <View style={styles.card}>
      <Text style={{ color: C.accent, fontWeight: "900", letterSpacing: 1 }}>MEMBERSHIP</Text>
      <Text style={{ color: C.text, fontSize: 22, fontWeight: "900", marginTop: 10 }}>{data.membership?.status || "INACTIVE"}</Text>
      <Text style={styles.subtitle}>$9.99/month. Membership becomes available only after the required verification and Bundle approval steps.</Text>
      <Button title="Manage subscription" onPress={() => Linking.openURL(Platform.OS === "ios" ? "https://apps.apple.com/account/subscriptions" : "https://play.google.com/store/account/subscriptions")} ghost />
    </View>

    <View style={styles.card}>
      <Text style={{ color: C.accent, fontWeight: "900", letterSpacing: 1 }}>SECURITY</Text>
      {sessions.map(s => <View key={s.id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line }}><Text style={{ color: C.text }}>{s.userAgent || "Bundle session"}</Text><Text style={{ color: C.muted, marginTop: 4 }}>{new Date(s.lastUsedAt).toLocaleString()}</Text><Button title="Revoke session" onPress={() => revokeSession(s.id)} ghost /></View>)}
      {sessions.length === 0 ? <Text style={styles.subtitle}>No active sessions.</Text> : null}
      <Button title="Sign out everywhere" onPress={async () => { const t = await getToken(); try { await api("/auth/logout", { method: "POST" }, t || undefined); } catch {} await clearToken(); router.replace("/"); }} ghost />
    </View>

    <View style={[styles.card, { borderColor: "#6d2730" }]}>
      <Text style={{ color: "#ff9aa7", fontWeight: "900", letterSpacing: 1 }}>DANGER ZONE</Text>
      <Field label="Password to delete account" value={pw} onChangeText={setPw} secureTextEntry />
      <Button title="Delete account permanently" onPress={deleteAccount} ghost />
      <Text style={styles.subtitle}>You can also submit a deletion request from the public Bundle website.</Text>
      <Button title="Open deletion page" onPress={() => Linking.openURL(`${WEB}/delete-account.html`)} ghost />
    </View>
    {message ? <Text style={{ color: C.muted, marginTop: 12 }}>{message}</Text> : null}
  </ScrollView>;
}
