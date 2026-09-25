import React, { useCallback, useEffect, useState } from "react";
import { Alert, Image, Pressable, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { syncLocation } from "../src/location";
import { api, post } from "../src/api";
import { getToken, clearToken } from "../src/session";
import { Button, styles, C } from "../src/ui";

export default function Main() {
  const [list, setList] = useState<any[]>([]);
  const [idx, setIdx] = useState(0);
  const [matches, setMatches] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"discover" | "matches">("discover");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const t = await getToken();
      const [d, m] = await Promise.all([
        api("/discover", {}, t || undefined),
        api("/matches", {}, t || undefined),
      ]);
      setList(d);
      setMatches(m);
      setIdx(0);
      await syncLocation().catch(() => null);
    } catch (e: any) {
      if (e.code === "EMAIL_REQUIRED") router.replace("/verify-email");
      else if (e.code === "PHONE_REQUIRED") router.replace("/verify-phone");
      else if (e.code === "KYC_REQUIRED") router.replace("/verification");
      else if (e.code === "PHOTO_REQUIRED") router.replace("/photo-verification");
      else if (e.code === "PROFILE_REVIEW_REQUIRED") router.replace("/review");
      else if (e.code === "MEMBERSHIP_REQUIRED") router.replace("/subscribe");
      else setError(e.message || "Unable to load Bundle right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function act(type: "like" | "pass") {
    const p = list[idx];
    if (!p) return;
    try {
      const t = await getToken();
      if (type === "like") {
        const d = await post(`/likes/${p.userId}`, {}, t || undefined);
        if (d.matched) setTab("matches");
      } else {
        await post(`/discovery/pass/${p.userId}`, {}, t || undefined);
      }
      setIdx((v) => v + 1);
      if (type === "like") setMatches(await api("/matches", {}, t || undefined));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function block(userId: string) {
    try {
      const t = await getToken();
      await post(`/blocks/${userId}`, {}, t || undefined);
      setIdx((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function logout() {
    const t = await getToken();
    try { await api("/auth/logout", { method: "POST" }, t || undefined); } catch {}
    await clearToken();
    router.replace("/");
  }

  const p = list[idx];

  if (loading && list.length === 0 && !error) {
    return <View style={[styles.center, { backgroundColor: C.bg }]}><Text style={{ color: C.muted }}>Loading verified members…</Text></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, padding: 18, paddingTop: 58 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={styles.brand}>BUNDLE</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
          <Pressable onPress={() => router.push("/notifications")}><Text style={{ color: C.accent, fontWeight: "800" }}>Inbox</Text></Pressable><Pressable onPress={() => router.push("/settings")}><Text style={{ color: C.accent, fontWeight: "800" }}>Settings</Text></Pressable>
          <Pressable onPress={logout}><Text style={{ color: C.muted, fontWeight: "700" }}>Sign out</Text></Pressable>
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 8, marginTop: 20 }}>
        <Pressable onPress={() => setTab("discover")} style={[styles.pill, { borderColor: tab === "discover" ? C.accent : C.line }]}>
          <Text style={{ color: tab === "discover" ? C.accent : C.text, fontWeight: "800" }}>Discover</Text>
        </Pressable>
        <Pressable onPress={() => setTab("matches")} style={[styles.pill, { borderColor: tab === "matches" ? C.accent : C.line }]}>
          <Text style={{ color: tab === "matches" ? C.accent : C.text, fontWeight: "800" }}>Matches</Text>
        </Pressable>
      </View>

      {tab === "discover" ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
          {p ? (
            <View style={{ marginTop: 18, borderRadius: 24, overflow: "hidden", borderWidth: 1, borderColor: C.line, backgroundColor: C.card }}>
              {p.photos?.[0]?.url ? (
                <Image source={{ uri: p.photos[0].url }} style={{ width: "100%", height: 430 }} resizeMode="cover" />
              ) : (
                <View style={{ height: 430, alignItems: "center", justifyContent: "center", backgroundColor: "#171722" }}>
                  <Text style={{ fontSize: 72, color: C.accent }}>{p.firstName?.[0]}</Text>
                </View>
              )}
              <View style={{ padding: 18 }}>
                <Text style={{ fontSize: 30, fontWeight: "800", color: C.text }}>{p.firstName}, {p.age}</Text>
                <Text style={{ color: C.muted, marginTop: 5 }}>{p.city}{p.distanceKm != null ? ` · ${p.distanceKm} km away` : ""} · Identity verified ✓ · Photo verified ✓</Text>
                {p.relationshipIntent ? <Text style={{ color: C.accent, fontWeight: "800", marginTop: 12 }}>{p.relationshipIntent}</Text> : null}
                {p.bio ? <Text style={{ color: C.text, lineHeight: 22, marginTop: 14 }}>{p.bio}</Text> : null}
                {p.interests?.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }}>{p.interests.slice(0, 8).map((x: string) => <View key={x} style={styles.pill}><Text style={{ color: C.muted }}>{x}</Text></View>)}</View> : null}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
                  <Button title="Report" onPress={() => router.push({ pathname: "/report", params: { userId: p.userId } })} ghost style={{ flex: 1 }} />
                  <Button title="Block" onPress={() => Alert.alert("Block profile", "This person will disappear from your discovery and cannot contact you.", [{ text: "Cancel", style: "cancel" }, { text: "Block", style: "destructive", onPress: () => block(p.userId) }])} ghost style={{ flex: 1 }} />
                </View>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                  <Button title="Pass" onPress={() => act("pass")} ghost style={{ flex: 1 }} />
                  <Button title="Like" onPress={() => act("like")} style={{ flex: 1 }} />
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.title}>No more profiles right now.</Text>
              <Text style={styles.subtitle}>Bundle will refresh your recommendation pool as verified members become available.</Text>
              <Button title="Refresh discovery" onPress={load} loading={loading} />
            </View>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
          {matches.map((m) => (
            <View key={m.id} style={styles.card}>
              <Text style={{ color: C.text, fontSize: 22, fontWeight: "800" }}>{m.user?.profile?.firstName || "Match"}</Text>
              <Text style={{ color: C.muted, marginTop: 5 }}>Identity verified ✓ · Photo verified ✓</Text>
              <Button title="Open conversation" onPress={() => router.push({ pathname: "/chat/[id]", params: { id: m.id } })} />
            </View>
          ))}
          {matches.length === 0 ? <View style={styles.card}><Text style={styles.subtitle}>No matches yet.</Text></View> : null}
        </ScrollView>
      )}
    </View>
  );
}
