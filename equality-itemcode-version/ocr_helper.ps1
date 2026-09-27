[OutputType([string])]
Param(
    [Parameter(Mandatory=$true)]
    [string]$ImagePath
)

$ErrorActionPreference = "Stop"

try {
    Add-Type -AssemblyName System.Drawing
    $drawingAssembly = [System.Drawing.Bitmap].Assembly.Location
    Add-Type -Path (Join-Path $PSScriptRoot 'ocr_image_preprocessor.cs') -ReferencedAssemblies $drawingAssembly
} catch {
    [Console]::Error.WriteLine("OCR preprocessing is unavailable; original frame will still be used: $($_.Exception.Message)")
}

# Load WinRT assemblies (requires Windows 10/11)
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
} catch {
    Write-Error "Failed to load System.Runtime.WindowsRuntime. Ensure you are running Windows 10 or 11."
    exit 1
}

$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]

# Helper to await WinRT async operations in PowerShell
$awaiter = [WindowsRuntimeSystemExtensions].GetMember('GetAwaiter', 'Method', 'Public,Static') | 
            Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | 
            Select-Object -First 1

if ($null -eq $awaiter) {
    [Console]::Error.WriteLine('WinRT OCR awaiter is unavailable in this PowerShell/.NET runtime.')
    exit 1
}

function Await-WinRT($AsyncTask, $Type) {
    return $awaiter.MakeGenericMethod($Type).Invoke($null, @($AsyncTask)).GetResult()
}

try {
    $absPath = [System.IO.Path]::GetFullPath($ImagePath)
    if (-not (Test-Path $absPath)) {
        Write-Error "Image file not found: $absPath"
        exit 1
    }
    
    # Use the profile OCR engine. The Windows.Globalization.Language projection
    # is not available in every PowerShell/.NET host, while this API works with
    # the WinRT types already loaded above. ItemCode extraction filters for the
    # expected Latin letters and digits afterwards.
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()

    if ($null -eq $engine) {
        [Console]::Error.WriteLine("Windows OCR Engine could not be created. Install an OCR language pack in Windows Settings.")
        exit 1
    }
    
    $variantPaths = @()
    if ('ItemCodeOcrImagePrep' -as [type]) {
        try { $variantPaths = [ItemCodeOcrImagePrep]::CreateVariants($absPath) }
        catch { [Console]::Error.WriteLine("OCR preprocessing failed; trying original frame: $($_.Exception.Message)") }
    }

    # Enhanced variants first so valid, prominent code overlays are discovered
    # before unrelated text. The original pass preserves colored/dark overlays.
    $passIndex = 0
    foreach ($candidatePath in (@($variantPaths) + @($absPath))) {
        Write-Output "__OCR_PASS_${passIndex}__"
        try {
            $fileTask = [Windows.Storage.StorageFile]::GetFileFromPathAsync([System.IO.Path]::GetFullPath($candidatePath))
            $file = Await-WinRT $fileTask ([Windows.Storage.StorageFile])
            $streamTask = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read)
            $stream = Await-WinRT $streamTask ([Windows.Storage.Streams.IRandomAccessStream])
            $decoderTask = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
            $decoder = Await-WinRT $decoderTask ([Windows.Graphics.Imaging.BitmapDecoder])
            $bitmapTask = $decoder.GetSoftwareBitmapAsync()
            $bitmap = Await-WinRT $bitmapTask ([Windows.Graphics.Imaging.SoftwareBitmap])
            $ocrTask = $engine.RecognizeAsync($bitmap)
            $result = Await-WinRT $ocrTask ([Windows.Media.Ocr.OcrResult])
            foreach ($line in $result.Lines) { Write-Output $line.Text }
        } catch {
            [Console]::Error.WriteLine("OCR pass failed: $($_.Exception.Message)")
        }
        if ($candidatePath -ne $absPath) {
            Remove-Item -LiteralPath $candidatePath -Force -ErrorAction SilentlyContinue
        }
        $passIndex++
    }
} catch {
    # Write-Error can replace the original exception when ErrorActionPreference
    # is Stop, so write the diagnostic directly to stderr instead.
    [Console]::Error.WriteLine("OCR helper failed: $($_.Exception.ToString())")
    exit 1
}
