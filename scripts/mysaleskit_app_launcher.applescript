property rootDir : ""
property runScript : ""
property outputFile : ""
property logDir : ""
property appLogPath : ""
property appExitPath : ""
property shellPath : "PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin "

my initializePaths()
my openMainMenu()

on initializePaths()
	set rootDir to my appRootDir()
	set runScript to rootDir & "/scripts/run_mysaleskit_cron.sh"
	set outputFile to rootDir & "/mysaleskit 最新数据.xlsx"
	set logDir to rootDir & "/logs"
	set appLogPath to logDir & "/mysaleskit-app-current.log"
	set appExitPath to rootDir & "/work/mysaleskit-app-current.exit"
end initializePaths

on openMainMenu()
	repeat
		try
			set menuChoice to my chooseOne({"开始导出", "配置", "打开上次结果"}, "请选择要执行的操作。", "MySalesKit 日常导出")
		on error number -128
			return
		end try

		if menuChoice is "开始导出" then
			my runExportWithStatus()
			return
		else if menuChoice is "配置" then
			my openConfigMenu()
		else if menuChoice is "打开上次结果" then
			my openExistingOutput(outputFile)
		end if
	end repeat
end openMainMenu

on runExportWithStatus()
	do shell script "mkdir -p " & quoted form of logDir & " " & quoted form of (rootDir & "/work") & " && rm -f " & quoted form of appExitPath & " " & quoted form of appLogPath
	display notification "正在导出 MySalesKit 数据。如果弹出浏览器，请完成登录验证。" with title "MySalesKit 日常导出"

	set launchCommand to "cd " & quoted form of rootDir & " && ( MYSK_LOG_FILE=" & quoted form of appLogPath & " bash " & quoted form of runScript & "; printf '%s' \"$?\" > " & quoted form of appExitPath & " ) >/dev/null 2>&1 & echo $!"
	do shell script launchCommand

	set progress total steps to 100
	set progress completed steps to 2
	set progress description to "MySalesKit 日常导出"
	set progress additional description to "正在启动..."

	set lastStatus to ""
	repeat while my fileExists(appExitPath) is false
		set latestStatus to my latestAppStatus(appLogPath)
		if latestStatus is "" then set latestStatus to "正在运行..."
		if latestStatus is not lastStatus then
			set progress additional description to latestStatus
			my notifyImportantStatus(latestStatus)
			set lastStatus to latestStatus
		end if
		if (progress completed steps) is less than 90 then set progress completed steps to (progress completed steps) + 2
		delay 2
	end repeat

	set progress completed steps to 100
	set exitCode to my readTextFile(appExitPath)
	set outputText to my readTextFile(appLogPath)

	if exitCode is "0" then
		my showSuccess(outputText)
	else
		my showFailure(outputText)
	end if
end runExportWithStatus

on openConfigMenu()
	repeat
		try
			set configChoice to my chooseOne({"配置 MyWorkbench", "配置邮箱", "保存电脑密码", "查看配置状态", "返回"}, "请选择要配置的项目。", "MySalesKit 配置")
		on error number -128
			return
		end try
		if configChoice is "返回" then return
		try
			if configChoice is "配置 MyWorkbench" then
				my configurePortal()
			else if configChoice is "配置邮箱" then
				my configureMail()
			else if configChoice is "保存电脑密码" then
				my configureMacPassword()
			else if configChoice is "查看配置状态" then
				my showConfigStatus()
			end if
		on error errMsg number errNum
			if errNum is not -128 then
				display dialog "操作失败：" & return & my truncateText(errMsg, 700) buttons {"关闭"} default button "关闭" with title "MySalesKit 配置" with icon stop
			end if
		end try
	end repeat
end openConfigMenu

on configurePortal()
	set currentAccount to my configuredAccount("portal")
	set portalAccount to text returned of (display dialog "请输入 MyWorkbench 账号。" default answer currentAccount buttons {"取消", "下一步"} default button "下一步" cancel button "取消" with title "配置 MyWorkbench" with icon note)
	if portalAccount is "" then
		display dialog "账号为空，已取消。" buttons {"关闭"} default button "关闭" with title "配置 MyWorkbench" with icon caution
		return
	end if
	set portalPassword to text returned of (display dialog "请输入 MyWorkbench 密码。" default answer "" hidden answer true buttons {"取消", "保存"} default button "保存" cancel button "取消" with title "配置 MyWorkbench" with icon note)
	if portalPassword is "" then
		display dialog "密码为空，已取消。" buttons {"关闭"} default button "关闭" with title "配置 MyWorkbench" with icon caution
		return
	end if
	do shell script "cd " & quoted form of rootDir & " && MYSK_PORTAL_ACCOUNT=" & quoted form of portalAccount & " MYSK_PORTAL_PASSWORD=" & quoted form of portalPassword & " bash scripts/store_portal_password.sh"
	display dialog "MyWorkbench 账号和密码已保存。" buttons {"关闭"} default button "关闭" with title "配置 MyWorkbench" with icon note
end configurePortal

on configureMail()
	set currentAccount to my configuredAccount("mail")
	set mailAccount to text returned of (display dialog "请输入邮箱账号。" default answer currentAccount buttons {"取消", "下一步"} default button "下一步" cancel button "取消" with title "配置邮箱" with icon note)
	if mailAccount is "" then
		display dialog "账号为空，已取消。" buttons {"关闭"} default button "关闭" with title "配置邮箱" with icon caution
		return
	end if
	set mailPassword to text returned of (display dialog "请输入邮箱密码。" default answer "" hidden answer true buttons {"取消", "保存"} default button "保存" cancel button "取消" with title "配置邮箱" with icon note)
	if mailPassword is "" then
		display dialog "密码为空，已取消。" buttons {"关闭"} default button "关闭" with title "配置邮箱" with icon caution
		return
	end if
	do shell script "cd " & quoted form of rootDir & " && MYSK_MAIL_ACCOUNT=" & quoted form of mailAccount & " MYSK_MAIL_PASSWORD=" & quoted form of mailPassword & " bash scripts/store_mail_password.sh"
	display dialog "邮箱账号和密码已保存。" buttons {"关闭"} default button "关闭" with title "配置邮箱" with icon note
end configureMail

on configureMacPassword()
	set macPassword to text returned of (display dialog "请输入这台 Mac 的登录密码。它只用于运行前尝试解锁 Keychain。" default answer "" hidden answer true buttons {"取消", "保存"} default button "保存" cancel button "取消" with title "保存电脑密码" with icon caution)
	if macPassword is "" then
		display dialog "密码为空，已取消。" buttons {"关闭"} default button "关闭" with title "保存电脑密码" with icon caution
		return
	end if
	do shell script "cd " & quoted form of rootDir & " && MYSK_MAC_PASSWORD=" & quoted form of macPassword & " bash scripts/store_mac_password.sh"
	display dialog "电脑密码已保存。之后运行会先尝试解锁 Keychain。" buttons {"关闭"} default button "关闭" with title "保存电脑密码" with icon note
end configureMacPassword

on showConfigStatus()
	set statusText to do shell script "cd " & quoted form of rootDir & " && " & shellPath & quoted form of (my nodePath()) & " scripts/mysaleskit_credentials.mjs status-text"
	display dialog statusText buttons {"关闭"} default button "关闭" with title "MySalesKit 配置状态" with icon note
end showConfigStatus

on showSuccess(outputText)
	set finalLine to my lineContaining(outputText, "finalTotal:")
	set updatedLine to my lineContaining(outputText, "updatedAt:")

	set resultMessage to "导出完成。" & return & return & "文件：mysaleskit 最新数据.xlsx"
	if finalLine is not "" then set resultMessage to resultMessage & return & my cleanSummaryLine(finalLine)
	if updatedLine is not "" then set resultMessage to resultMessage & return & my cleanSummaryLine(updatedLine)

	display notification "导出完成。" with title "MySalesKit 日常导出"
	set successChoice to button returned of (display dialog resultMessage buttons {"关闭", "定位文件", "打开文件"} default button "打开文件" with title "MySalesKit 日常导出" with icon note)
	if successChoice is "打开文件" then
		do shell script "open " & quoted form of outputFile
	else if successChoice is "定位文件" then
		do shell script "open -R " & quoted form of outputFile
	end if
end showSuccess

on showFailure(outputText)
	display notification "导出失败，请查看日志。" with title "MySalesKit 日常导出"
	set latestLog to my latestLogPath(logDir)
	set failMessage to "导出失败。" & return & return & "错误信息：" & return & my truncateText(outputText, 1200)
	if latestLog is not "" then set failMessage to failMessage & return & return & "可以打开最新日志查看详情。"

	set failChoice to button returned of (display dialog failMessage buttons {"关闭", "打开日志文件夹", "打开最新日志"} default button "打开最新日志" with title "MySalesKit 日常导出" with icon stop)
	if failChoice is "打开最新日志" then
		if latestLog is not "" then
			do shell script "open " & quoted form of latestLog
		else
			do shell script "open " & quoted form of logDir
		end if
	else if failChoice is "打开日志文件夹" then
		do shell script "open " & quoted form of logDir
	end if
end showFailure

on chooseOne(choices, promptText, titleText)
	set selectedItems to choose from list choices with prompt promptText with title titleText OK button name "继续" cancel button name "取消"
	if selectedItems is false then error number -128
	return item 1 of selectedItems as text
end chooseOne

on configuredAccount(kind)
	try
		return do shell script "cd " & quoted form of rootDir & " && " & shellPath & quoted form of (my nodePath()) & " scripts/mysaleskit_credentials.mjs get " & quoted form of kind
	on error
		return ""
	end try
end configuredAccount

on appRootDir()
	set appPath to POSIX path of (path to me)
	return do shell script "p=" & quoted form of appPath & "; if [ -d \"$p\" ]; then cd \"$p/..\"; else cd \"$(dirname \"$p\")/..\"; fi; pwd"
end appRootDir

on nodePath()
	try
		return do shell script shellPath & "command -v node"
	on error
		error "没有找到 Node.js。请先安装 Node.js 20+，然后重新打开 app。"
	end try
end nodePath

on latestAppStatus(logPath)
	try
		return do shell script "if [ -f " & quoted form of logPath & " ]; then awk '/\\[APP_STATUS\\]/{line=$0} END{sub(/^.*\\[APP_STATUS\\][[:space:]]*/,\"\",line); print line}' " & quoted form of logPath & "; fi"
	on error
		return ""
	end try
end latestAppStatus

on notifyImportantStatus(statusText)
	if statusText contains "等待人工" then
		display notification statusText with title "MySalesKit 日常导出"
	else if statusText contains "可见浏览器" then
		display notification statusText with title "MySalesKit 日常导出"
	else if statusText contains "导出完成" then
		display notification statusText with title "MySalesKit 日常导出"
	else if statusText contains "失败" then
		display notification statusText with title "MySalesKit 日常导出"
	end if
end notifyImportantStatus

on openExistingOutput(outputFile)
	try
		do shell script "test -f " & quoted form of outputFile
		do shell script "open " & quoted form of outputFile
	on error
		display dialog "还没有找到上次导出的文件。" buttons {"关闭"} default button "关闭" with title "MySalesKit 日常导出" with icon caution
	end try
end openExistingOutput

on latestLogPath(logDir)
	try
		return do shell script "ls -t " & quoted form of logDir & "/mysaleskit-*.log " & quoted form of logDir & "/mysaleskit-app-current.log 2>/dev/null | head -1"
	on error
		return ""
	end try
end latestLogPath

on fileExists(filePath)
	try
		do shell script "test -f " & quoted form of filePath
		return true
	on error
		return false
	end try
end fileExists

on readTextFile(filePath)
	try
		return do shell script "cat " & quoted form of filePath
	on error
		return ""
	end try
end readTextFile

on lineContaining(theText, marker)
	set oldDelimiters to AppleScript's text item delimiters
	set AppleScript's text item delimiters to linefeed
	set theLines to text items of theText
	set AppleScript's text item delimiters to oldDelimiters
	repeat with oneLine in theLines
		if (oneLine as text) contains marker then return oneLine as text
	end repeat
	return ""
end lineContaining

on cleanSummaryLine(theLine)
	set cleanedLine to theLine
	set cleanedLine to my replaceText(cleanedLine, "  finalTotal:", "导出条数：")
	set cleanedLine to my replaceText(cleanedLine, "  updatedAt:", "更新时间：")
	return cleanedLine
end cleanSummaryLine

on replaceText(theText, searchText, replacementText)
	set oldDelimiters to AppleScript's text item delimiters
	set AppleScript's text item delimiters to searchText
	set textParts to text items of theText
	set AppleScript's text item delimiters to replacementText
	set joinedText to textParts as text
	set AppleScript's text item delimiters to oldDelimiters
	return joinedText
end replaceText

on truncateText(theText, maxLength)
	if (length of theText) is less than or equal to maxLength then return theText
	return "..." & return & (text ((length of theText) - maxLength + 1) thru (length of theText) of theText)
end truncateText
