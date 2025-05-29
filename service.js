const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const chains = require('./chains');
const axios = require("axios")
const abi = chains.utils.abi;
const sepolia = chains.testnet.sepolia;
const moment = require('moment-timezone');
const etc = chains.utils.etc
const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const contractAddress = "0x5FbE74A283f7954f10AA04C2eDf55578811aeb03";
const graphqlEndpoint = "https://graphql.union.build/v1/graphql";
const selectedWallets = global.selectedWallets || [];
const wallets = selectedWallets;

async function pollPacketHash(txHash, retries = 50, intervalMs = 5000) {
  const headers = {
    'accept': 'application/graphql-response+json, application/json',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'accept-language': 'en-US,en;q=0.9,id;q=0.8',
    'content-type': 'application/json',
    'origin': 'https://app.union.build',
    'referer': 'https://app.union.build/',
    'user-agent': 'Mozilla/5.0',
  };
  const data = {
    query: `
      query ($submission_tx_hash: String!) {
        v2_transfers(args: {p_transaction_hash: $submission_tx_hash}) {
          packet_hash
        }
      }
    `,
    variables: {
      submission_tx_hash: txHash.startsWith("0x") ? txHash : `0x${txHash}`,
    },
  };

  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.post(graphqlEndpoint, data, { headers });
      const result = res.data?.data?.v2_transfers;

      if (result && result.length > 0 && result[0].packet_hash) {
        return result[0].packet_hash;
      }
    } catch (e) {
      console.error("❌ Packet error:", e.message);
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
 }
async function checkBalanceAndApproveUSDC(wallet, USDC_ADDRESS, spenderAddress) {
  const usdcContract = new ethers.Contract(USDC_ADDRESS, abi.USDC, wallet);
  
  const balance = await usdcContract.balanceOf(wallet.address);
  if (balance === 0n) {
    console.log(`🛑 ${wallet.address} has 0 USDC. Please claim faucet first at https://faucet.circle.com`);
    return false;
  }

  const allowance = await usdcContract.allowance(wallet.address, spenderAddress);
  if (allowance === 0n) {
    console.log(`✍️ USDC is not allowance. Sending approve transaction....`);

    const approveAmount = ethers.MaxUint256;
    try {
      const tx = await usdcContract.approve(spenderAddress, approveAmount);
      const receipt = await tx.wait();
      console.log(`✅ Approve confirmed: ${sepolia.explorer.tx(receipt.hash)}`);
	  await etc.delay(3000);
    } catch (err) {
      console.error(`❌ Approve failed:`, err.message);
      return false;
    }
  } else {
  }
  return true;
}
async function sepoliaHolesky() {
  for (const w of global.selectedWallets || []) {
    const { privatekey, name} = w;
    if (!privatekey) {
      console.warn(`⚠️ Skip ${name || "wallet with missing data"}.`);
      continue;
    }
    try {
      const wallet = new ethers.Wallet(privatekey, sepolia.provider());
      const address = wallet.address;
      const addressHex = address.slice(2);
      const shouldProceed = await checkBalanceAndApproveUSDC(wallet, USDC_ADDRESS, contractAddress);
      if (!shouldProceed) continue;
      const contract = new ethers.Contract(contractAddress, abi.UCS03, wallet);
      const channelId = 8;
      const timeoutHeight = 0;

      const instruction = {
        version: 0,
        opcode: 2,
        operand: `0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000002c00000000000000000000000000000000000000000000000000000000000000140000000000000000000000000000000000000000000000000000000000000018000000000000000000000000000000000000000000000000000000000000001c000000000000000000000000000000000000000000000000000000000000000640000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000028000000000000000000000000000000000000000000000000000000000000000640000000000000000000000000000000000000000000000000000000000000014${addressHex}0000000000000000000000000000000000000000000000000000000000000000000000000000000000000014${addressHex}00000000000000000000000000000000000000000000000000000000000000000000000000000000000000141c7d4b196cb0c7b01d743fbc6116a902379c72380000000000000000000000000000000000000000000000000000000000000000000000000000000000000004555344430000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000045553444300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001457978bfe465ad9b1c0bf80f6c1539d300705ea50000000000000000000000000`
      };
      for (let i = 1; i <= global.maxTransaction; i++) {
        console.log(`🚀 ${name} | Transaction Sepolia → Holesky ${i} from ${global.maxTransaction}`);
        const timestampNow = Math.floor(Date.now() / 1000);
        const salt = ethers.keccak256(
          ethers.solidityPacked(["address", "uint256"], [wallet.address, timestampNow])
        );
        const now = BigInt(Date.now()) * 1_000_000n;
        const oneDayNs = 86_400_000_000_000n;
        const timeoutTimestamp = (now + oneDayNs).toString();
        const tx = await contract.send(channelId, timeoutHeight, timeoutTimestamp, salt, instruction);
        await tx.wait(1);
        console.log(`✅ ${name} | ${etc.timelog()} | Transaction Confirmed: ${sepolia.explorer.tx(tx.hash)}`);
		const txHash = tx.hash.startsWith("0x") ? tx.hash : `0x${tx.hash}`;
		await etc.delay(2000);
		const packetHash = await pollPacketHash(txHash);
		console.log(`✅ ${name} | ${etc.timelog()} | Packet Details: ${etc.union.tx(packetHash)}`);
      }
    } catch (err) {
      console.error(`❌ ${name} | ${etc.timelog()} | Error:`, err.message);
    }
  }
}
async function sepoliaBabylon() {
  for (const w of global.selectedWallets || []) {
    const { privatekey, name, babylonAddress } = w;
    if (!babylonAddress || !privatekey) {
      console.warn(`⚠️ Skip ${name || "wallet with missing data"}.`);
      continue;
    }
    try {
      const wallet = new ethers.Wallet(privatekey, sepolia.provider());
      const sender = wallet.address;
      const senderHex = sender.slice(2);
      const shouldProceed = await checkBalanceAndApproveUSDC(wallet, USDC_ADDRESS, contractAddress);
      if (!shouldProceed) continue;

      const contract = new ethers.Contract(contractAddress, abi.UCS03, wallet);
      const recipient = babylonAddress;
      const recipientHex = Buffer.from(recipient, "utf8").toString("hex");
      const channelId = 7;
      const timeoutHeight = 0;

      const instruction = {
        version: 0,
        opcode: 2,
        operand: `0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000140000000000000000000000000000000000000000000000000000000000000018000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000064000000000000000000000000000000000000000000000000000000000000022000000000000000000000000000000000000000000000000000000000000002600000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002a000000000000000000000000000000000000000000000000000000000000000640000000000000000000000000000000000000000000000000000000000000014${senderHex}000000000000000000000000000000000000000000000000000000000000000000000000000000000000002a${recipientHex}0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000141c7d4b196cb0c7b01d743fbc6116a902379c72380000000000000000000000000000000000000000000000000000000000000000000000000000000000000004555344430000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000045553444300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003e62626e317a7372763233616b6b6778646e77756c3732736674677632786a74356b68736e743377776a687030666668363833687a7035617135613068366e0000`
      };

      for (let i = 1; i <= global.maxTransaction; i++) {
        console.log(`🚀 ${name} | Transaction Sepolia → Babylon ${i} from ${global.maxTransaction}`);
        const timestampNow = Math.floor(Date.now() / 1000);
        const salt = ethers.keccak256(
          ethers.solidityPacked(["address", "uint256"], [wallet.address, timestampNow])
        );
        const now = BigInt(Date.now()) * 1_000_000n;
        const oneDayNs = 86_400_000_000_000n;
        const timeoutTimestamp = (now + oneDayNs).toString();
        const tx = await contract.send(channelId, timeoutHeight, timeoutTimestamp, salt, instruction);
        await tx.wait(1);
        console.log(`✅ ${name} | ${etc.timelog()} | Transaction Confirmed: ${sepolia.explorer.tx(tx.hash)}`);
		const txHash = tx.hash.startsWith("0x") ? tx.hash : `0x${tx.hash}`;
		await etc.delay(2000);
		const packetHash = await pollPacketHash(txHash);
		console.log(`✅ ${name} | ${etc.timelog()} | Packet Details: ${etc.union.tx(packetHash)}`);
      }
    } catch (err) {
      console.error(`❌ ${name} | ${etc.timelog()} | Error:`, err.message);
    }
  }
}

async function checkPoint() {
  for (const w of global.selectedWallets || []) {
    const { privatekey, name, userId } = w;
    if (!userId || !privatekey) {
      console.warn(`⚠️ Skip ${name || "wallet"} due to missing private key or userId.`);
      continue;
    }

    const headers = {
      'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvcnF6cHVyeXJnZm5lY2FkYWpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQzNzM0NDAsImV4cCI6MjA0OTk0OTQ0MH0.4xkWpfMkYgBz4nqUGkZVjQNP7NxLa4filDoJRCI3yWo'
    };

    try {
      const pointUrl = `https://api.dashboard.union.build/rest/v1/leaderboard?select=*&user_id=eq.${userId}`;
      const response = await axios.get(pointUrl, { headers });
      const data = response.data;

      if (Array.isArray(data) && data.length > 0) {
        const {
          rank,
          total_xp,
          level,
          current_xp,
          xp_required,
          title,
          display_name
        } = data[0];

        console.log(`✅ ${name} | ${etc.timelog()} | Name: ${display_name} | Rank: ${rank} | Title: ${title} | Level: ${level} | Total XP: ${total_xp} | Current XP: ${current_xp} | XP Required: ${xp_required}`);
      } else {
        console.log(`⚠️ No data found for ${name}`);
      }
    } catch (err) {
      if (axios.isAxiosError(err)) {
        console.error(`❌ ${etc.timelog()} | ${name} | Error: ${err.message}`);
      } else {
        console.error(`❌ ${etc.timelog()} | ${name} | Unexpected Error: ${err.message}`);
      }
    }
    await etc.countdown(10000, "Countdown");
  }
}

module.exports = { 
sepoliaBabylon,
sepoliaHolesky,
checkPoint,
};
