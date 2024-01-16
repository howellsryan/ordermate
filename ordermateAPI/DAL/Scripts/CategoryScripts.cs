namespace ordermateAPI.DAL.Scripts;

public static class CategoryScripts
{
    public static string GetByCategoryId = "SELECT * FROM Categories WHERE CategoryId = @id";
    public static string Get = "SELECT * FROM Categories";
}