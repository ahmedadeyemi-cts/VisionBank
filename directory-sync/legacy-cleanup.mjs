// User-approved removal of the 35 unchanged legacy entries identified on 2026-10-15.
// Exact fingerprints prevent removing a subsequently edited or Webex-linked row.
const approved=new Set([
  "a4a7dfaeb07668ed3d819ebfc47c907df71119391dd3f8d94bf92bf484689c69",
  "e88c0084c569339d75d8d6b40edce7e4d82316396538486d54b445604cb10ec7",
  "067efe4e6c83c6a915e7e370aa6f1cfb1558a8d6fd2e059aef23c66cafc7802d",
  "db66bb4c8865ed55a545ea19d49c0d21904197c8048f3d47109eb23bc7601986",
  "1f9a45a50ac9d28f343d23a9576cc0520367b543914026e447abe40e4c6f940b",
  "cfedd3c6bd75dc7f126658876e51a95d504b31f909440d7db3afe66052104ad6",
  "af630b7a0315d45f0bef7bb2b03b54af9ab032421a0de073292612770f98dbe9",
  "cd1b91c58a185e3e28b42a3abf3d5023d62401ec966a75e93f5d5f0e20a3d5f2",
  "0d7ea9e9a3a65e094fca47508adaf31c21870e5f37bf2845cf73770cfd123cf6",
  "4087d5c304a4b7c4069e0a7e4cf5e19901eda368010d85412de070f91504f932",
  "de6d96217c07191d026b74869ce014c96d0a2f9980164b56e35c4cb5b40448eb",
  "65c82be553f5d4d3bc7fcea141a99d2f4774d19408b567fdca08be1b8c02550a",
  "e24767a876cfa1448ad277999095681bc9f78a67ae8663c0de49e07ec115031b",
  "c38552790e7d539fc64010c24a5b0abfb085acbea0e69d1d4819c9c32244bc3c",
  "117c7e3b43ed16358c44b6b9cd38afadf6e5bfccb4b93efc8dca337b639dc8d9",
  "36dba3f4ec17f2cc7b7646e69fb0375e49870be4f6f68be616166f6fadf539e9",
  "d85bc1ca5f845ac73a7860a45cabf58af5f61aec88416f5459fe9d33489eb977",
  "2fa934355eba31f853fe2e3f41470148d6b99e34bdcb38b6cb394fdb84ed2618",
  "925a6cecf2a6d0c02768b50b16f9e6ffcd668cc88a7f5df943fb57c0bc80bc0b",
  "34384d9c7f1cbdaa3f941ed9a95e60def289ad72db9e542ca799dac5bb8934d2",
  "57f3e2f13be32032ef879d34c3a523194f38841efbb82dbb08a5c64d8e2741b1",
  "e3cd49ee5b7a08a68adb2f7633588eea93f546bcf35868a84217b63e8768a4f7",
  "25c866c37c82b0ad1f3f110b9d8b60a43064ba324e4734816daab2eb7f707d09",
  "397066b9c89a971fbe85f76456e686f32690f17508cceade95ef4d9f1ee7a27c",
  "c25a0793a70d2628abbb57f3ea0645da60a3d612bf03075727903e276d3b6d31",
  "0f797478dd5292b7925e03fc2c1bbeaf06775bfcef711e7e7489ee76a33268dd",
  "9794a883549cd567e26808df14351942967101d4d21c9c8851d92bea60775611",
  "4af9b65d781369019b77aea710878e07e32b702241ec30aaefc5f1394bb30034",
  "625998ec244ab3b8a1f40de06f4e9e1fdd4449ca10ed205a92394957a059b5f9",
  "409e877e9e41c2fa072e1cda73c2a48ee01d8293ff8c2c18644353b6340ed729",
  "765f4d7b723a8c20ecc452ed6a7295b7ac9bd0e1667b0ba114917136da16202f",
  "06ffe9543df39ebcb26b8b70a0928bd756f6953ab493ff7c0081654b40c0ffc5",
  "abe9b5b4ddb647cc704a12ea27a1644d3f5715345ae56bae5511dd9da1c325f2",
  "9137bc36a535d6ff12992a3e433e714460703b654c6214e8f6e7ad42d8c9a548",
  "1e1a070acbe5decc87aeaf1a1b13e4e9b6ab28cbb7af390bc148489c82401fa6"
]);
export async function removeApprovedLegacy(contacts){
 const rows=[];let removed=0;
 for(const row of contacts){
  if(row.webexDirectoryId||/^wg/i.test(String(row.firstName||'').trim())){rows.push(row);continue;}
  const value=JSON.stringify(Object.fromEntries(Object.entries(row).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b))));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
  if(approved.has(hash))removed++;else rows.push(row);
 }return {rows,removed};
}
