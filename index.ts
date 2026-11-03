/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// I had called this Message Search, but Global Search is probably more accurate so you may see that in the code ;3

import definePlugin from "@utils/types";

import { MessageSearchChatBarIcon, SearchIcon } from "./MessageSearchChatBarIcon";

export default definePlugin({
    name: "Global Search",
    description: "Search through messages in all DM channels and group DMs globally",
    authors: [{ name: "Jaisal (AtomicByte)", id: 0n, badge: false }],
    chatBarButton: {
        icon: SearchIcon,
        render: MessageSearchChatBarIcon
    }
});
