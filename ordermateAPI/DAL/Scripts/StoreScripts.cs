namespace ordermateAPI.DAL.Scripts;

public class StoreScripts
{
    public static string Get = "SELECT TOP 1 * FROM Stores WHERE StoreId = @storeId;";
}