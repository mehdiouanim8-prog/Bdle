import React,{useEffect}from"react";import{View,ActivityIndicator}from"react-native";import{router}from"expo-router";
export default function VerificationComplete(){useEffect(()=>{router.replace("/pending")},[]);return <View style={{flex:1,backgroundColor:"#08080D",alignItems:"center",justifyContent:"center"}}><ActivityIndicator color="#B88A3B"/></View>}
