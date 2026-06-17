const fs = require("fs");
const FormData = require("form-data");
const axios = require("axios");

// Uploads a file to Gofile and returns a shareable download link
async function uploadToGofile(filePath, filename) {
  try {
    // Get best available server
    const serverRes = await axios.get("https://api.gofile.io/servers", { timeout: 10000 });
    const server = serverRes.data?.data?.servers?.[0]?.name || "store1";

    const form = new FormData();
    form.append("file", fs.createReadStream(filePath), filename);

    const uploadRes = await axios.post(
      `https://${server}.gofile.io/contents/uploadfile`,
      form,
      {
        headers: form.getHeaders(),
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024,
        timeout: 60000,
      }
    );

    const data = uploadRes.data?.data;
    if (!data) return { success: false, error: "Upload failed, no data returned" };

    return {
      success: true,
      downloadPage: data.downloadPage,
      directLink: data.downloadPage,
    };
  } catch (err) {
    console.error("Gofile upload error:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { uploadToGofile };
