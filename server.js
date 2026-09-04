import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

const systemPrompt = fs.readFileSync('./systemPrompt.txt', 'utf-8');
const conversas = {};

function gerenciarHistorico(whatsappId, novaMensagem, tipoUsuario) {
    if (!conversas[whatsappId]) {
        conversas[whatsappId] = [];
    }
    conversas[whatsappId].push({
        role: tipoUsuario,
        content: novaMensagem
    });
    if (conversas[whatsappId].length > 15) {
        conversas[whatsappId].shift();
    }
    return conversas[whatsappId];
}

app.post('/webhook', async (req, res) => {
    try {
        const payload = req.body;
        if (!payload.data || !payload.data.message || payload.data.key.fromMe) {
            return res.sendStatus(200);
        }
        const whatsappId = payload.data.key.remoteJid;
        const textoCliente = payload.data.message.conversation || payload.data.message.extendedTextMessage?.text;

        if (!textoCliente) return res.sendStatus(200);

        const historicoAtualizado = gerenciarHistorico(whatsappId, textoCliente, 'user');

        const msgClaude = await anthropic.messages.create({
            model: "claude-3-haiku-20240307",
            max_tokens: 1024,
            system: systemPrompt,
            messages: historicoAtualizado,
        });

        const respostaBot = msgClaude.content[0].text;
        gerenciarHistorico(whatsappId, respostaBot, 'assistant');
        await enviarMensagemWhatsapp(whatsappId, respostaBot);
        res.sendStatus(200);
    } catch (error) {
        console.error("Erro ao processar o atendimento:", error);
        res.sendStatus(500);
    }
});

async function enviarMensagemWhatsapp(whatsappId, texto) {
    const numeroLimpo = whatsappId.replace('@s.whatsapp.net', '');
    const url = `${process.env.WHATSAPP_API_URL}/message/sendText/${process.env.WHATSAPP_INSTANCE_TOKEN}`;
    
    const payload = {
        number: numeroLimpo,
        options: { 
            delay: 2500, 
            presence: "composing" 
        },
        text: texto
    };

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'apikey': process.env.AUTHENTICATION_API_KEY || ''
            },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.error("Falha ao enviar mensagem de volta ao WhatsApp:", err);
    }
}

const PORT = 8080;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🤖 Atendente virtual Marina online na porta ${PORT}`);
});
