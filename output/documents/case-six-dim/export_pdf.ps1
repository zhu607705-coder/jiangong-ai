param([string]$DocumentPath, [string]$PdfPath)
$ErrorActionPreference = 'Stop'
$officeApp = $null
$officeDocument = $null
$initialDocumentCount = 0
$originalVisible = $false
$originalAlerts = 0
try {
    $officeApp = New-Object -ComObject Word.Application
    $initialDocumentCount = $officeApp.Documents.Count
    $originalVisible = $officeApp.Visible
    $originalAlerts = $officeApp.DisplayAlerts
    if ($initialDocumentCount -eq 0) { $officeApp.Visible = $false }
    $officeApp.DisplayAlerts = 0
    $officeDocument = $officeApp.Documents.Open($DocumentPath, $false, $true, $false)
    $officeDocument.Repaginate()
    $officeDocument.ExportAsFixedFormat($PdfPath, 17)
    [pscustomobject]@{PdfPath=$PdfPath;Pages=$officeDocument.ComputeStatistics(2);Application=$officeApp.Name} | ConvertTo-Json -Compress
}
finally {
    if ($null -ne $officeDocument) { $officeDocument.Close(0); [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($officeDocument) }
    if ($null -ne $officeApp) {
        $officeApp.DisplayAlerts = $originalAlerts
        $officeApp.Visible = $originalVisible
        if ($initialDocumentCount -eq 0 -and $officeApp.Documents.Count -eq 0) { $officeApp.Quit() }
        [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($officeApp)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
