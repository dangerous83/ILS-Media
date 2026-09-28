// Applies the CORS policy browser uploads need to the R2 bucket.
// Usage: node --env-file=.env.local scripts/r2-cors.mjs https://your-app.vercel.app
import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";

const origins = process.argv.slice(2);
if (!origins.length) {
  console.error("Pass one or more allowed origins, e.g. https://ils-media.vercel.app http://localhost:3000");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

await client.send(
  new PutBucketCorsCommand({
    Bucket: process.env.R2_BUCKET,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: origins,
          AllowedMethods: ["GET", "PUT", "HEAD"],
          AllowedHeaders: ["*"],
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);
console.log(`CORS applied to ${process.env.R2_BUCKET} for: ${origins.join(", ")}`);
