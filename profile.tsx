import React, { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { ScrollView, Text, View } from "react-native";
import { getStorageItem, setStorageItem, deleteStorageItem } from "../src/storage";
import { router } from "expo-router";
import { api, put } from "../src/api";
import { getToken } from "../src/session";
import { Button, Field, Step, styles } from "../src/ui";

const DRAFT_KEY = "bundle_profile_draft";

export default function Profile() {
  const [firstName, setFirst] = useState("");
  const [birthDate, setBirth] = useState("");
  const [gender, setGender] = useState("");
  const [lookingFor, setLooking] = useState("");
  const [city, setCity] = useState("");
  const [bio, setBio] = useState("");
  const [intent, setIntent] = useState("");
  const [occupation, setOccupation] = useState("");
  const [education, setEducation] = useState("");
  const [interests, setInterests] = useState("");
  const [languages, setLanguages] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const draftReady = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const t = await getToken();
        const m = await api("/me", {}, t || undefined);
        const p = m.profile;
        const raw = await getStorageItem(DRAFT_KEY);
        const d = raw ? JSON.parse(raw) : null;
        setFirst(d?.firstName ?? p?.firstName ?? "");
        setBirth(d?.birthDate ?? p?.birthDate?.slice?.(0, 10) ?? "");
        setGender(d?.gender ?? p?.gender ?? "");
        setLooking(d?.lookingFor ?? p?.lookingFor ?? "");
        setCity(d?.city ?? p?.city ?? "");
        setBio(d?.bio ?? p?.bio ?? "");
        setIntent(d?.intent ?? p?.relationshipIntent ?? "");
        setOccupation(d?.occupation ?? p?.occupation ?? "");
        setEducation(d?.education ?? p?.education ?? "");
        setInterests(d?.interests ?? (p?.interests || []).join(", "));
        setLanguages(d?.languages ?? (p?.languages || []).join(", "));
      } catch {} finally {
        draftReady.current = true;
      }
    })();
  }, []);

  useEffect(() => {
    if (!draftReady.current) return;
    const draft = { firstName, birthDate, gender, lookingFor, city, bio, intent, occupation, education, interests, languages };
    const timer = setTimeout(() => setStorageItem(DRAFT_KEY, JSON.stringify(draft)).catch(() => undefined), 250);
    return () => clearTimeout(timer);
  }, [firstName, birthDate, gender, lookingFor, city, bio, intent, occupation, education, interests, languages]);

  async function save() {
    setBusy(true); setError("");
    try {
      const t = await getToken();
      await put("/profile", {
        firstName, birthDate, gender, lookingFor, city, bio: bio || undefined,
        relationshipIntent: intent || undefined, occupation: occupation || undefined, education: education || undefined,
        interests: interests.split(",").map(x => x.trim()).filter(Boolean), languages: languages.split(",").map(x => x.trim()).filter(Boolean)
      }, t || undefined);
      await deleteStorageItem(DRAFT_KEY).catch(() => undefined);
      router.replace("/photos");
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return <ScrollView contentContainerStyle={styles.scroll}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 25 }}>
      {Platform.OS==="web"?<><Step n={1} label="Email" done/><Step n={2} label="Profile" active/><Step n={3} label="Identity"/></>:<><Step n={1} label="Email" done/><Step n={2} label="Phone" done/><Step n={3} label="Profile" active/><Step n={4} label="Identity"/></>}
    </View>
    <Text style={styles.brand}>PROFILE</Text>
    <Text style={styles.title}>Build a profile people can trust.</Text>
    <Text style={styles.subtitle}>Use your real details. Profile changes return to Bundle review before dating access is restored.</Text>
    <View style={styles.card}>
      <Field label="First name" value={firstName} onChangeText={setFirst} placeholder="First name"/>
      <Field label="Birth date" value={birthDate} onChangeText={setBirth} placeholder="YYYY-MM-DD"/>
      <Field label="Gender" value={gender} onChangeText={setGender} placeholder="Gender"/>
      <Field label="Looking for" value={lookingFor} onChangeText={setLooking} placeholder="Who are you looking for?"/>
      <Field label="City" value={city} onChangeText={setCity} placeholder="City"/>
      <Field label="Relationship intention" value={intent} onChangeText={setIntent} placeholder="Long-term, marriage, dating..."/>
      <Field label="Occupation" value={occupation} onChangeText={setOccupation} placeholder="Occupation"/>
      <Field label="Education" value={education} onChangeText={setEducation} placeholder="Education"/>
      <Field label="Interests" value={interests} onChangeText={setInterests} placeholder="Music, travel, sport"/>
      <Field label="Languages" value={languages} onChangeText={setLanguages} placeholder="English, Arabic, French"/>
      <Field label="About you" value={bio} onChangeText={setBio} placeholder="Tell people something meaningful" multiline/>
      <Button title="Save & continue" onPress={save} loading={busy}/>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  </ScrollView>;
}
